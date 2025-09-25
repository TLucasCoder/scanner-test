"use client";

import { useEffect, useRef, useState } from "react";

export default function IDScanner() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Debug / intermediate stage canvases
  const stage1Ref = useRef<HTMLCanvasElement | null>(null); // Preprocessed
  const stage2Ref = useRef<HTMLCanvasElement | null>(null); // Morphology
  const stage3Ref = useRef<HTMLCanvasElement | null>(null); // GrabCut
  const stage4Ref = useRef<HTMLCanvasElement | null>(null); // Edges
  const stage5Ref = useRef<HTMLCanvasElement | null>(null); // Contours
  const stage6Ref = useRef<HTMLCanvasElement | null>(null); // Final warped result

  const [cvReady, setCvReady] = useState(false);

  // Load OpenCV.js
  useEffect(() => {
    const script = document.createElement("script");
    script.src = "https://docs.opencv.org/4.9.0/opencv.js";
    script.async = true;
    script.onload = () => {
      // @ts-ignore
      window.cv["onRuntimeInitialized"] = () => {
        setCvReady(true);
        console.log("✅ OpenCV.js fully initialized");
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
          videoRef.current.onloadedmetadata = () => {
            if (videoRef.current) {
                const { videoWidth, videoHeight } = videoRef.current;
                const ratio = videoWidth / videoHeight;

                // ✅ Apply real aspect ratio dynamically
                videoRef.current.style.aspectRatio = `${videoWidth} / ${videoHeight}`;
                videoRef.current.parentElement!.style.aspectRatio = `${videoWidth} / ${videoHeight}`;

                console.log("📸 Camera resolution:", videoWidth, "x", videoHeight, "→ aspect", ratio.toFixed(2));
            }
          };
        }
        

        
      } catch (err) {
        console.error("Camera error:", err);
      }
    }
    startCamera();
  }, []);

  // ---- Pipeline functions ----

  function preprocess(cv: any, src: any) {

    // grayscale
    const gray = new cv.Mat();
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY, 0);

    // thresholding
    const equalized = new cv.Mat();
    const clahe = new cv.CLAHE(3.0, new cv.Size(16,16));  
    clahe.apply(gray, equalized);
    cv.imshow(stage1Ref.current!, equalized);

    // blurring
    
    cv.GaussianBlur(equalized, equalized, new cv.Size(21,21), 0);
    cv.imshow(stage1Ref.current!, equalized);
    //cv.imshow(stage1Ref.current!, gray);
    return equalized;
  }

  function morphologicalClose(cv: any, img: any, itr: number) {
    let current = img.clone();   // make a copy so we don’t overwrite the original

    const kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(40, 40));

    for (let i = 0; i < itr; i++) {
        const temp = new cv.Mat();
        cv.morphologyEx(current, temp, cv.MORPH_CLOSE, kernel);
        current.delete();   // free the old one
        current = temp;     // use the new one as input for next iteration
    }

    cv.imshow(stage2Ref.current!, current);

    return current;
  }


  function applyGrabCut(cv: any, src: any) {
    // Ensure we have a 3-channel image
    let colorSrc = new cv.Mat();
    if (src.type() === cv.CV_8UC4) {
    cv.cvtColor(src, colorSrc, cv.COLOR_RGBA2RGB);
    } else if (src.type() === cv.CV_8UC1) {
    cv.cvtColor(src, colorSrc, cv.COLOR_GRAY2RGB);
    } else {
    colorSrc = src.clone();
    }
    console.log("3-channel image ensured");
    //const mask = new cv.Mat.zeros(colorSrc.rows, colorSrc.cols, cv.CV_8UC1);
    const mask = new cv.Mat(colorSrc.rows, colorSrc.cols, cv.CV_8UC1, new cv.Scalar(cv.GC_BGD));
    const bgdModel = new cv.Mat(1, 65, cv.CV_64FC1, new cv.Scalar(0));
    const fgdModel = new cv.Mat(1, 65, cv.CV_64FC1, new cv.Scalar(0));
    // Assume doc is roughly central
    const rect = new cv.Rect(
        50,
        50,
        Math.max(1, colorSrc.cols - 50),
        Math.max(1, colorSrc.rows - 50)
    );
    try {
        cv.grabCut(colorSrc, mask, rect, bgdModel, fgdModel, 5, cv.GC_INIT_WITH_RECT);
    } 
    catch (err) {
        console.error("GrabCut failed:", err);
        return src.clone(); // fallback
    }
    console.log("grab_cut done");
    // Extract probable foreground
    const resultMask = new cv.Mat();
    cv.compare(mask, new cv.Mat(mask.rows, mask.cols, mask.type(), new cv.Scalar(cv.GC_PR_FGD)), resultMask, cv.CMP_EQ);
    console.log("probable forground extracted");
    const foreground = new cv.Mat();
    colorSrc.copyTo(foreground, resultMask);

    cv.imshow(stage3Ref.current!, foreground);

    // cleanup
    colorSrc.delete(); mask.delete(); bgdModel.delete(); fgdModel.delete(); resultMask.delete();
    console.log("cleanup done");
    return foreground;
    }


  function detectEdges(cv: any, img: any) {
    /*
    const gray = new cv.Mat();
    cv.cvtColor(img, gray, cv.COLOR_RGBA2GRAY, 0);
    cv.GaussianBlur(gray, gray, new cv.Size(7,7), 0);
    //cv.imshow(stage1Ref.current!, gray);
    */
   // wipe out small blob
    cv.morphologyEx(img, img, cv.MORPH_OPEN, cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(15, 15)));
   
    const edges = new cv.Mat();
    cv.Canny(img, edges, 15, 60);
    const dilated = new cv.Mat();
    const kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(15, 15));
    cv.dilate(edges, dilated, kernel);

    cv.imshow(stage4Ref.current!, edges);
    return edges;
  }

  function findAndDrawContours(cv: any, src: any, edges: any) {
    const contours = new cv.MatVector();
    const hierarchy = new cv.Mat();
    cv.findContours(edges, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

    const contourImg = cv.Mat.zeros(src.rows, src.cols, cv.CV_8UC3);
    for (let i = 0; i < contours.size(); i++) {
      const color = new cv.Scalar(0, 255, 0);
      cv.drawContours(contourImg, contours, i, color, 2);
    }
    cv.imshow(stage5Ref.current!, contourImg);

    contours.delete(); hierarchy.delete();
    return contourImg;
  }

  function warpDocument(cv: any, src: any) {
    // Dummy warp (identity) – replace with approxPolyDP logic
    cv.imshow(stage6Ref.current!, src);
  }

  // ---- Main processing ----
  const processImage = (canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D) => {
    // @ts-ignore
    const cv = window.cv;
    const src = cv.imread(canvas);
    console.log("cv.imread");

    // stage 1: preprocessing
    const gray = preprocess(cv, src);

    // Stage 2: Morphological ops
    const morph = morphologicalClose(cv, gray, 5);
    console.log("morphologicalClose");

    // Stage 3: GrabCut
    //const grab = applyGrabCut(cv, morph);

    // Stage 4: Edge detection
    const edges = detectEdges(cv, morph);
    //const edges = detectEdges(cv, gray);

    // Stage 5: Contours
    findAndDrawContours(cv, src, edges);

    // Stage 6: find rect

    // Stage 7: Warp (placeholder)
    warpDocument(cv, src);

    src.delete(); 
    gray.delete(); 
    morph.delete(); 
    //grab.delete(); 
    edges.delete();
  };

  // ---- Capture frame ----
  const handleCapture = () => {
    if (!cvReady || !videoRef.current || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const video = videoRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    processImage(canvas, ctx);
    console.log("handle capture");
  };



  return (
    <div className="flex flex-col items-center space-y-4 p-4">
      {/* Camera preview with overlay */}
      <div
        className="relative w-full max-w-lg"
        style={{ aspectRatio: "16 / 9" }} // replaced dynamically in code above
        >
        <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="w-full h-full object-contain rounded-lg shadow-lg"
        />
        <div className="absolute inset-x-8 top-1/4 h-1/2 border-2 border-dashed border-white/80 rounded-lg pointer-events-none"></div>
        </div>

      {/* Controls */}
      <div className="flex space-x-4">
        <button
          onClick={() => { console.log("clicked"); handleCapture(); }}
          disabled={!cvReady}
          className="px-4 py-2 rounded bg-blue-600 text-white disabled:opacity-50 "
        >
          Capture
        </button>
      </div>

      {/* Debug Stages */}
      <div className="flex flex-col items-center max-w-5xl w-full p-3">
        <canvas ref={canvasRef} className="hidden" />
        <h1>Stage 1: Preprocess (Grayscale)</h1>
        <canvas ref={stage1Ref} className="w-1/2 bg-gray-900 rounded-lg" />

        <h1 className="mt-5">Stage 2: Morphological Closing</h1>
        <canvas ref={stage2Ref} className="w-1/2 bg-gray-900 rounded-lg" />

        {//<h1 className="mt-5">Stage 3: GrabCut Result</h1>
        //<canvas ref={stage3Ref} className="w-1/2 bg-gray-900 rounded-lg" />
        }

        <h1 className="mt-5">Stage 4: Edge Detection</h1>
        <canvas ref={stage4Ref} className="w-1/2 bg-gray-900 rounded-lg" />

        <h1 className="mt-5">Stage 5: Contours</h1>
        <canvas ref={stage5Ref} className="w-1/2 bg-gray-900 rounded-lg" />

        <h1 className="mt-5">Stage 6: Final Warp</h1>
        <canvas ref={stage6Ref} className="w-1/2 bg-gray-900 rounded-lg" />
      </div>
    </div>
  );
}
