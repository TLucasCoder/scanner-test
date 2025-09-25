"use client";

import { useEffect, useRef, useState } from "react";

export default function IDScanner() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const testRef = useRef<HTMLCanvasElement | null>(null);
  const testRef1 = useRef<HTMLCanvasElement | null>(null);
  const testRef2 = useRef<HTMLCanvasElement | null>(null);
  const outCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [cvReady, setCvReady] = useState(false);
  const [captured, setCaptured] = useState(false);
  // @ts-ignore
  const cv = window.cv;
  
  
  interface Window {
    cv: any;
  }
  

  // Load OpenCV.js
  useEffect(() => {
    console.log("init.");
    const script = document.createElement("script");
    script.src = "https://docs.opencv.org/4.9.0/opencv.js";
    script.async = true;
    script.onload = () => {
      // @ts-ignore
      window.cv['onRuntimeInitialized'] = () => {
        setCvReady(true);
        console.log("✅ OpenCV.js fully initialized");
        // @ts-ignore
        //console.log(window.cv.getBuildInformation());
      };
    };
    document.body.appendChild(script);
  }, []);

  // Start camera
  useEffect(() => {
    async function startCamera() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
          audio: false,
        });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
      } catch (err) {
        console.error("Camera error:", err);
      }
    }
    startCamera();
  }, []);

  function matToPoints(mat: any): { x: number; y: number }[] {
    const pts: { x: number; y: number }[] = [];
    // Each row contains a Vec2 (x,y). Use intPtr/floatPtr instead of intAt.
    for (let i = 0; i < mat.rows; i++) {
      // prefer intPtr; if your mat is float, use floatPtr
      const p = mat.intPtr(i, 0); // [x, y]
      pts.push({ x: p[0], y: p[1] });
    }
    return pts;
  }


  const processImage = (canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D) => {
    const testCan = testRef.current;
    const testCan1 = testRef1.current;

    // --- 2. Load into OpenCV as a Mat object ---
    // @ts-ignore
    const cv = window.cv;
    const src = cv.imread(canvas); // read pixels from <canvas> into cv.Mat

    // --- 3. Preprocess image (convert → blur → edges) ---
    // gray scale
    const dst = new cv.Mat();
    cv.cvtColor(src, dst, cv.COLOR_RGBA2GRAY, 0); // grayscale

    // equalise
    const equalized = new cv.Mat();
    const clahe = new cv.CLAHE(2.0, new cv.Size(8,8));  
    clahe.apply(dst, equalized);
    
    //blurring
    const blurred = new cv.Mat();
    cv.bilateralFilter(equalized, blurred, 9, 30, 30);
    //cv.GaussianBlur(equalized, blurred, new cv.Size(9,9), 0); // blur to reduce noise

    const edges = new cv.Mat();
    cv.Canny(blurred, edges, 30, 80); // edge detection

    const kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(13, 13)); 
    cv.morphologyEx(edges, edges, cv.MORPH_CLOSE, kernel);


    cv.imshow(testRef2.current!,blurred);
    cv.imshow(testCan1,edges);

    // --- 4. Find contours (shapes) ---
    const contours = new cv.MatVector();
    const hierarchy = new cv.Mat();
    cv.findContours(
      edges,
      contours,
      hierarchy,
      cv.RETR_EXTERNAL,
      cv.CHAIN_APPROX_SIMPLE
    );

    // --- 5. Pick the largest rectangular contour (4 corners) ---
    let bestCnt = null;
    let maxArea = 0;
    console.log("+++++++++++++++++++++++++++++++++++++++++++");
    for (let i = 0; i < contours.size(); i++) {

      const cnt = contours.get(i);
      const rect = cv.minAreaRect(cnt);
      const vertices = cv.RotatedRect.points(rect); // gives 4 vertices
      const ratio = rect.size.width / rect.size.height;
      const aspect = ratio > 1 ? ratio : 1 / ratio;

      const boxArea = rect.size.width * rect.size.height;
      const contourArea = cv.contourArea(cnt);
      //const minArea = (canvas.width * canvas.height) * 0.05; // 5% of frame
      const minArea = 15000;

      
      const peri = cv.arcLength(cnt, true);
      const approx = new cv.Mat();
      const hull = new cv.Mat();
      cv.convexHull(cnt, hull, true, true); // force closed convex shape
      cv.approxPolyDP(hull, approx, 0.02 * peri, true); // approximate contour


      if (contourArea < minArea) continue; // skip small shapes
      
      console.log("approx.rows: ", approx.rows);
      if (approx.rows === 4  && contourArea > maxArea) {
        maxArea = contourArea; // biggest 4-point shape so far
        bestCnt = approx; // save it
      }


    }
    console.log("Contours found:", contours.size());
    console.log("Best contour:", bestCnt ? "yes" : "no"); 
    console.log("bestCnt: ", bestCnt);


    // --- 6. If we found a rectangle, warp it into a flat crop ---
    if (bestCnt && outCanvasRef.current) {

      const pts = matToPoints(bestCnt); 
      console.log("pts: ",pts);
      console.log();


      //const cropped = cropDocument(src, pts);

      const colors = [
        [255, 0, 0, 255],     // top-left → red
        [0, 0, 255, 255],     // top-right → blue
        [255, 255, 0, 255],   // bottom-right → yellow
        [0, 255, 0, 255],     // bottom-left → green
      ];

      // Sort into [top-left, top-right, bottom-right, bottom-left]
      const [tl, tr, br, bl] = orderPoints(pts);

      // Calculate output width/height from corner distances
      const widthA = Math.hypot(br.x - bl.x, br.y - bl.y);
      const widthB = Math.hypot(tr.x - tl.x, tr.y - tl.y);
      const maxWidth = Math.max(widthA, widthB);

      const heightA = Math.hypot(tr.x - br.x, tr.y - br.y);
      const heightB = Math.hypot(tl.x - bl.x, tl.y - bl.y);
      const maxHeight = Math.max(heightA, heightB);

      // Define perspective transform (map 4 corners → flat rectangle)
      const srcTri = cv.matFromArray(4, 1, cv.CV_32FC2, [
        tl.x, tl.y,
        tr.x, tr.y,
        br.x, br.y,
        bl.x, bl.y,
      ]);
      const dstTri = cv.matFromArray(4, 1, cv.CV_32FC2, [
        0, 0,
        maxWidth - 1, 0,
        maxWidth - 1, maxHeight - 1,
        0, maxHeight - 1,
      ]);
      for (let i = 0; i < 4; i++) {
        cv.circle(src, new cv.Point(pts[i].x, pts[i].y), 12, colors[i], -1);
      }
      cv.imshow(testRef.current!, src);

      // Warp (deskew) the card to a proper rectangle
      const M = cv.getPerspectiveTransform(srcTri, dstTri);
      const warped = new cv.Mat();
      cv.warpPerspective(src, warped, M, new cv.Size(maxWidth, maxHeight));

      // Show the warped image on the output canvas
      const outCanvas = outCanvasRef.current;
      outCanvas.width = maxWidth;
      outCanvas.height = maxHeight;
      cv.imshow(outCanvas, warped);

      // Update React state (enables Upload button)
      setCaptured(true);
    }

    // --- 7. Cleanup to avoid memory leaks ---
    src.delete();
    dst.delete();
    edges.delete();
    contours.delete();
    hierarchy.delete();

  }

  // Capture frame and process
  const handleCapture = () => {
    // ✅ Early exit if OpenCV not ready or refs missing
    if (!cvReady || !videoRef.current || !canvasRef.current) return;

    // --- 1. Take a snapshot from the video feed ---
    const canvas = canvasRef.current;
    
    const video = videoRef.current;
    canvas.width = video.videoWidth;   // match canvas size to video frame
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height); // draw current frame
    processImage(canvas,ctx);
    
  };


  // Order corner points
  function orderPoints(pts: { x: number; y: number }[]) {
    // tl: min(x+y), br: max(x+y)
    let tl = pts[0], br = pts[0], tr = pts[0], bl = pts[0];

    for (const p of pts) {
      if (p.x + p.y < tl.x + tl.y) tl = p;
      if (p.x + p.y > br.x + br.y) br = p;
    }
    // tr: max(x - y), bl: min(x - y)
    for (const p of pts) {
      const d = p.x - p.y;
      const dTr = tr.x - tr.y, dBl = bl.x - bl.y;
      if (d > dTr) tr = p;
      if (d < dBl) bl = p;
    }
    return [tl, tr, br, bl]; // TL, TR, BR, BL
  }


  // Upload captured image
  const handleUpload = async () => {
    if (!outCanvasRef.current) return;
    const blob = await new Promise<Blob | null>((resolve) =>
      outCanvasRef.current!.toBlob(resolve, "image/jpeg", 0.95)
    );
    if (!blob) return;

    const formData = new FormData();
    formData.append("file", blob, "id_scan.jpg");

    const res = await fetch("/api/upload", {
      method: "POST",
      body: formData,
    });

    if (res.ok) alert("Upload successful!");
    else alert("Upload failed");
  };

  const handleFileChange =   (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    
    if (!file || !canvasRef.current) return;

    const img = new Image();
    img.onload =  () =>  {
      const canvas = canvasRef.current!;
      const ctx = canvas.getContext("2d")!;
      canvas.width = img.width;
      canvas.height = img.height;
      ctx.drawImage(img, 0, 0);

      processImage(canvas,ctx);
      /*
      const base64 = await fileToBase64(file);
      const vertices = await detectDocumentFromVision(base64);
      if (vertices && outCanvasRef.current) {
        // Use same warp logic as your processImage
        const src = cv.imread(canvas);
        const cropped = cropDocument(src, vertices); // you'll need to copy your warp code into a helper
        cv.imshow(outCanvasRef.current, cropped);
        //const outCanvas = outCanvasRef.current;
        //outCanvas.width = maxWidth;
        //outCanvas.height = maxHeight;
        //cv.imshow(outCanvas, cropped);
        setCaptured(true);
      }
        */

    };
    img.src = URL.createObjectURL(file);
  };

  function fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve((reader.result as string).split(",")[1]);
      reader.onerror = (err) => reject(err);
      reader.readAsDataURL(file);
    });
  }

  async function detectDocumentFromVision(base64Image: string) {
      const apiKey = process.env.NEXT_PUBLIC_GOOGLE_VISION_KEY; // put your key in .env.local
      const url = `https://vision.googleapis.com/v1/images:annotate?key=${apiKey}`;

      const body = {
        requests: [
          {
            image: { content: base64Image },
            features: [{ type: "DOCUMENT_TEXT_DETECTION" }]
          }
        ]
      };

      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const json = await res.json();
      const vertices =
        json.responses?.[0]?.fullTextAnnotation?.pages?.[0]?.blocks?.[0]?.boundingBox?.vertices;

      return vertices || null; // [{x,y},...]
    }

  function cropDocument(src: any, vertices: {x:number,y:number}[]) {
    const [tl, tr, br, bl] = orderPoints(vertices);

    const widthA = Math.hypot(br.x - bl.x, br.y - bl.y);
    const widthB = Math.hypot(tr.x - tl.x, tr.y - tl.y);
    const maxWidth = Math.max(widthA, widthB);

    const heightA = Math.hypot(tr.x - br.x, tr.y - br.y);
    const heightB = Math.hypot(tl.x - bl.x, tl.y - bl.y);
    const maxHeight = Math.max(heightA, heightB);

    const srcTri = cv.matFromArray(4, 1, cv.CV_32FC2, [
      tl.x, tl.y,
      tr.x, tr.y,
      br.x, br.y,
      bl.x, bl.y,
    ]);
    const dstTri = cv.matFromArray(4, 1, cv.CV_32FC2, [
      0, 0,
      maxWidth - 1, 0,
      maxWidth - 1, maxHeight - 1,
      0, maxHeight - 1,
    ]);

    const M = cv.getPerspectiveTransform(srcTri, dstTri);
    const dst = new cv.Mat();
    cv.warpPerspective(src, dst, M, new cv.Size(maxWidth, maxHeight));
    return dst;
  }


  

  return (
    <div className="flex flex-col items-center space-y-4 p-4">
      {/* Camera preview with overlay guide */}
      <div className="relative w-full max-w-lg">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          className="w-full rounded-lg shadow-lg"
        />
        {/* Guide box overlay */}
        <div className=
          "absolute inset-x-8 top-1/4 h-1/2 border-2 border-dashed border-white/80 rounded-lg pointer-events-none"></div>
      </div>
      {/* Controls */}
      <div className="flex space-x-4">
        <input
          type="file"
          accept="image/*"
          onChange={handleFileChange}
          className="mb-4 bg-gray-600"
          
        />
        <button
          onClick={handleCapture}
          disabled={!cvReady}
          className="px-4 py-2 rounded bg-blue-600 text-white disabled:opacity-50"
        >
          Capture
        </button>
        <button
          onClick={handleUpload}
          disabled={!captured}
          className="px-4 py-2 rounded bg-green-600 text-white disabled:opacity-50"
        >
          Upload
        </button>
      </div>
      <div className="flex flex-col items-center max-w-5xl w-full p-3">
          {/* Hidden capture canvas */}
          <h1>Video stream captured image</h1>
          <canvas ref={canvasRef} className=" realative w-1/2 bg-gray-900 rounded-lg" />

          {/* Result preview */}
          <h1 className="mt-5">Crop result</h1>
          <canvas
            ref={outCanvasRef}
            className=" w-1/2 rounded-lg shadow-lg  bg-gray-900"
          />
          <h1 className="mt-5">Edge detection result</h1>
          <canvas
            ref={testRef}
            className=" w-1/2 rounded-lg shadow-lg  bg-gray-900"
          />
          <h1 className="mt-5">equalisation + filtering result</h1>
          <canvas
            ref={testRef1}
            className=" w-1/2 rounded-lg shadow-lg  bg-gray-900"
          />
          <h1 className="mt-5">equalisation + filtering result</h1>
          <canvas
            ref={testRef2}
            className=" w-1/2 rounded-lg shadow-lg  bg-gray-900"
          />
          
      </div>
      

      
    </div>
  );
}
