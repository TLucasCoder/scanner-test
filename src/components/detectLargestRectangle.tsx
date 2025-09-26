   const detectLargestRectangle = async () => {
        if (!window.cv || !window.cv.imread || !webcamRef.current || !canvasRef.current) return;
        const imageSrc = webcamRef.current.getScreenshot();
        if (!imageSrc) return;

        // Create image element
        const img = new window.Image();
        img.src = imageSrc;
        await new Promise(resolve => { img.onload = resolve; });

        // Draw image on canvas
        const canvas = canvasRef.current;
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) return;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0);

        // Read image with OpenCV
        const src = window.cv.imread(canvas);

        // 1. Convert to grayscale
        let gray = new window.cv.Mat();
        window.cv.cvtColor(src, gray, window.cv.COLOR_RGBA2GRAY, 0);

        // 2. Blur to reduce noise
        let blurred = new window.cv.Mat();
        window.cv.GaussianBlur(gray, blurred, new window.cv.Size(5, 5), 0);

        // 3. Use Canny edge detection for better edges
        let edges = new window.cv.Mat();
        window.cv.Canny(blurred, edges, 50, 150);

        // 4. Morphological close to connect edges
        let kernel = window.cv.getStructuringElement(window.cv.MORPH_RECT, new window.cv.Size(5, 5));
        let closed = new window.cv.Mat();
        window.cv.morphologyEx(edges, closed, window.cv.MORPH_CLOSE, kernel);

        // 5. Find contours
        let contours = new window.cv.MatVector();
        let hierarchy = new window.cv.Mat();
        window.cv.findContours(closed, contours, hierarchy, window.cv.RETR_EXTERNAL, window.cv.CHAIN_APPROX_SIMPLE);

        // 6. Find the largest rectangle-like contour with stricter checks
        let maxRect = null;
        let maxArea = 0;
        for (let i = 0; i < contours.size(); ++i) {
            const contour = contours.get(i);
            const peri = window.cv.arcLength(contour, true);
            const approx = new window.cv.Mat();
            window.cv.approxPolyDP(contour, approx, 0.02 * peri, true);

            // Rectangle: 4 points, convex, reasonable aspect ratio
            if (
                approx.rows === 4 &&
                window.cv.isContourConvex(approx)
            ) {
                const area = window.cv.contourArea(approx);
                if (area > maxArea) {
                    // Check aspect ratio (rectangle, not line)
                    const rect = window.cv.boundingRect(approx);
                    const aspect = rect.width / rect.height;
                    if (area > 10000 && aspect > 0.5 && aspect < 2.5) {
                        maxArea = area;
                        maxRect = rect;
                    }
                }
            }
            approx.delete();
        }

        // Draw green border if found
        let rectangleFound = false;

        if (maxRect && maxRect.width > 0 && maxRect.height > 0) {
            rectangleFound = true;
            ctx.strokeStyle = 'green';
            ctx.lineWidth = 4;
            ctx.strokeRect(maxRect.x, maxRect.y, maxRect.width, maxRect.height);

            const croppedCanvas = document.createElement('canvas');
            croppedCanvas.width = maxRect.width;
            croppedCanvas.height = maxRect.height;
            const croppedCtx = croppedCanvas.getContext('2d', { willReadFrequently: true });
            if (croppedCtx) {
                croppedCtx.drawImage(
                    img,
                    maxRect.x, maxRect.y, maxRect.width, maxRect.height,
                    0, 0, maxRect.width, maxRect.height
                );
            }
            const croppedBase64 = croppedCanvas.toDataURL('image/jpeg');

            if (!ocrStarted && !ocrTimeoutRef.current) {
                setRectangleDetected(true);
                setOcrStarted(true);
                ocrTimeoutRef.current = setTimeout(() => {
                    // Stop auto-detection interval
                    if (intervalRef.current) {
                        clearInterval(intervalRef.current);
                        intervalRef.current = null;
                    }
                    handleOCRdetect(croppedBase64);
                    ocrTimeoutRef.current = null;
                }, 5000);
            }
        } else {
            rectangleFound = false;
        }

        // If rectangle disappears before 5 seconds, reset timer and flags
        if (!rectangleFound && ocrTimeoutRef.current) {
            clearTimeout(ocrTimeoutRef.current);
            ocrTimeoutRef.current = null;
            setRectangleDetected(false);
            setOcrStarted(false);
        }

        // Clean up
        src.delete(); gray.delete(); blurred.delete(); edges.delete(); closed.delete(); kernel.delete(); contours.delete(); hierarchy.delete();





    };