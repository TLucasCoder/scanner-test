"use client";

import { useEffect, useRef, useState } from "react";

export default function IDScanner() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const testRef = useRef<HTMLCanvasElement | null>(null);
  const testRef1 = useRef<HTMLCanvasElement | null>(null);
  const outCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [cvReady, setCvReady] = useState(false);
  const [captured, setCaptured] = useState(false);

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


  const processImage = (canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D) => {
    const testCan = testRef.current;
    const testCan1 = testRef1.current;

    // --- 2. Load into OpenCV as a Mat object ---
    // @ts-ignore
    const cv = window.cv;
    const src = cv.imread(canvas); // read pixels from <canvas> into cv.Mat

    // --- 3. Preprocess image (convert → blur → edges) ---
    const dst = new cv.Mat();
    
    cv.cvtColor(src, dst, cv.COLOR_RGBA2GRAY, 0); // grayscale
    const equalized = new cv.Mat();
    cv.equalizeHist(dst, equalized); 
    
    const blurred = new cv.Mat();
    cv.bilateralFilter(equalized, blurred, 20, 25, 25);
    //cv.GaussianBlur(equalized, blurred, new cv.Size(7,7), 0); // blur to reduce noise
    const edges = new cv.Mat();
    cv.Canny(blurred, edges, 30, 80); // edge detection

    // 3. Adaptive Threshold
    /*
    const thresh1 = new cv.Mat();
    cv.adaptiveThreshold(
      equalized,
      thresh1,
      255,
      cv.ADAPTIVE_THRESH_GAUSSIAN_C,
      cv.THRESH_BINARY,
      11, // block size (odd number, local window)
      2   // constant subtracted from mean
    );*/

    //const edges = thresh;
    
    const kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(25, 5)); // wide horizontal
    cv.morphologyEx(edges, edges, cv.MORPH_CLOSE, kernel);

    const kernel2 = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(5, 25)); // wide vertical
    cv.morphologyEx(edges, edges, cv.MORPH_CLOSE, kernel2);

    cv.imshow(testCan,edges);
    cv.imshow(testCan1,blurred);

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
    for (let i = 0; i < contours.size(); i++) {
      const cnt = contours.get(i);
      const area = cv.contourArea(cnt);
      //const minArea = (canvas.width * canvas.height) * 0.05; // 5% of frame
      const minArea = 15000;
      console.log("area: ", area);
      console.log("minArea: ", minArea);
      if (area < minArea) continue; // skip small shapes
      

      const peri = cv.arcLength(cnt, true);
      const approx = new cv.Mat();
      const hull = new cv.Mat();
      cv.convexHull(cnt, hull, true, true); // force closed convex shape
      cv.approxPolyDP(hull, approx, 0.02 * peri, true); // approximate contour
      
      console.log("approx.rows: ", approx.rows);
      if (approx.rows === 4  && area > maxArea) {
        maxArea = area; // biggest 4-point shape so far
        bestCnt = approx; // save it
      }
    }
    console.log("Contours found:", contours.size());
    console.log("Best contour:", bestCnt ? "yes" : "no"); 

    // --- 6. If we found a rectangle, warp it into a flat crop ---
    if (bestCnt && outCanvasRef.current) {
      // Extract the 4 corner points
      const pts: { x: number; y: number }[] = [];
      for (let i = 0; i < 4; i++) {
        pts.push({ x: bestCnt.intAt(i, 0), y: bestCnt.intAt(i, 1) });
      }

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
    // Sort points by sum of coordinates
    pts.sort((a, b) => a.x + a.y - (b.x + b.y));
    const tl = pts[0]; // smallest sum → top-left
    const br = pts[3]; // largest sum → bottom-right
    const [p1, p2] = [pts[1], pts[2]];
    // Distinguish remaining two points
    const tr = p1.x > p2.x ? p1 : p2;
    const bl = p1.x > p2.x ? p2 : p1;
    return [tl, tr, br, bl];
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

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !canvasRef.current) return;

    const img = new Image();
    img.onload = () => {
      const canvas = canvasRef.current!;
      const ctx = canvas.getContext("2d")!;
      canvas.width = img.width;
      canvas.height = img.height;
      ctx.drawImage(img, 0, 0);

      processImage(canvas,ctx);
    };
    img.src = URL.createObjectURL(file);
  };

  

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
          
      </div>
      

      
    </div>
  );
}
