import { NextRequest, NextResponse } from "next/server";
import multer from "multer";
import fs from "fs";
import path from "path";

// Temp storage with Multer
const upload = multer({ dest: "uploads/" });

// Trick: wrap Multer to work in Next.js App Router
function runMiddleware(req: any, res: any, fn: any) {
  return new Promise((resolve, reject) => {
    fn(req, res, (result: any) => {
      if (result instanceof Error) return reject(result);
      return resolve(result);
    });
  });
}

export async function POST(req: NextRequest) {
  // Next.js Request → Node req/res bridge
  // For simplicity, just read as a buffer (works without Multer too)
  const data = await req.formData();
  const file = data.get("file") as File;
  if (!file) {
    return NextResponse.json({ error: "No file" }, { status: 400 });
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const filePath = path.join(process.cwd(), "uploads", file.name);
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  await fs.promises.writeFile(filePath, bytes);

  return NextResponse.json({ ok: true, path: filePath });
}
