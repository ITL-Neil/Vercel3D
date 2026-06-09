// server.js — ITL 3D Demo Backend API Server
// Endpoints: GET /, GET /api/health, POST /api/compress
// Start: node server.js  or  npm start

import express from 'express';
import cors from 'cors';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';

import { convertToGlb, isFormatSupported, isGlbFile } from './converter.js';
import { compressGlb } from './compressor.js';

const PORT = process.env.PORT || 5100;
const MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024; // 2 GB
const TEMP_DIR = path.join(os.tmpdir(), 'glb-compress-api');

const app = express();

app.use(cors({
  origin: ['http://localhost:5173', 'http://127.0.0.1:5173'],
  exposedHeaders: ['Content-Disposition', 'X-Original-Size', 'X-Compressed-Size', 'X-Compression-Ratio'],
}));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES },
});

app.get('/', (_req, res) => {
  res.json({
    service: 'ITL 3D Demo Backend',
    version: '1.0.0',
    runtime: 'Node.js (ESM)',
    endpoints: ['GET /api/health', 'POST /api/compress'],
    features: {
      conversion: 'assimpjs (WebAssembly) — 70+ 3D formats → GLB',
      compression: 'gltf-transform CLI — Draco + WebP',
    },
  });
});

app.get('/api/health', (_req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

app.post('/api/compress', upload.single('file'), async (req, res) => {
  let inputPath = null;
  let glbPath = null;
  let outputPath = null;

  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });

    const file = req.file;
    const uploadExt = path.extname(file.originalname).toLowerCase();
    if (!isFormatSupported(file.originalname)) {
      return res.status(400).json({ error: `Unsupported file format: ${uploadExt}` });
    }

    if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });

    const uploadId = crypto.randomUUID().replace(/-/g, '');
    const safeExt = uploadExt.replace('.', '');
    inputPath = path.join(TEMP_DIR, `${uploadId}.${safeExt}`);
    fs.writeFileSync(inputPath, file.buffer);
    const originalBaseName = path.basename(file.originalname, uploadExt);

    if (isGlbFile(file.originalname)) {
      glbPath = inputPath;
    } else {
      glbPath = path.join(TEMP_DIR, `${uploadId}_converted.glb`);
      console.error(`[Server] Format conversion: ${file.originalname} → GLB`);
      await convertToGlb(inputPath, glbPath);
      console.error(`[Server] Format conversion complete`);
    }

    console.error(`[Server] Starting compression: ${glbPath}`);
    const result = await compressGlb(glbPath, TEMP_DIR, originalBaseName);
    outputPath = result.outputPath;
    console.error(`[Server] Compression complete: ${result.compressionRatio}%`);

    res.setHeader('X-Original-Size', String(result.originalSizeBytes));
    res.setHeader('X-Compressed-Size', String(result.compressedSizeBytes));
    res.setHeader('X-Compression-Ratio', String(result.compressionRatio));
    res.setHeader('Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(result.outputFileName)}`);

    res.setHeader('Content-Type', 'application/octet-stream');
    res.send(fs.readFileSync(outputPath));

  } catch (err) {
    console.error('[Server] Processing failed:', err);
    const status = /Unsupported|format|upload|file|No file/i.test(err.message) ? 400 : 500;
    res.status(status).json({ error: err.message });
  } finally {
    for (const p of [inputPath, glbPath, outputPath]) {
      try { if (p && p !== inputPath && fs.existsSync(p)) fs.unlinkSync(p); } catch {}
    }
    try { if (inputPath && fs.existsSync(inputPath)) fs.unlinkSync(inputPath); } catch {}
  }
});

app.listen(PORT, () => {
  console.log(`[Server] ITL 3D Demo Backend started (ESM)`);
  console.log(`[Server] http://localhost:${PORT}`);
  console.log(`[Server] POST http://localhost:${PORT}/api/compress`);
});
