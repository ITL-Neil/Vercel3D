// converter.js — 3D Model Format Conversion
// Uses assimpjs (Emscripten WASM) to convert 70+ 3D formats to GLB.
// Strategy: prefer direct GLB export, fallback to glTF → gltf-transform CLI pack to GLB
// Depends on: assimpjs (npm), gltf-transform CLI (fallback only)

import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';

let _assimp = null;
async function getAssimp() {
  if (!_assimp) {
    const { initAssimp } = await import('assimpjs');
    _assimp = await initAssimp();
  }
  return _assimp;
}

const SUPPORTED_EXTENSIONS = new Set([
  '.glb', '.gltf', '.ply', '.stl', '.obj', '.off', '.dae', '.fbx',
  '.dxf', '.ifc', '.xyz', '.pcd', '.las', '.laz', '.stp', '.step',
  '.3dxml', '.iges', '.igs', '.shp', '.geojson', '.xaml', '.pts', '.asc',
  '.brep', '.fcstd', '.bim', '.usdz', '.pdb', '.vtk', '.svg', '.wrl',
  '.3dm', '.3ds', '.amf', '.3mf', '.dwg', '.json', '.rfa', '.rvt',
  '.cvs', '.gpkg', '.ac', '.zgl', '.x', '.ter', '.smd', '.sib',
  '.q3o', '.q3s', '.ogex', '.nff', '.ms3d', '.mdl', '.md5mesh', '.md2',
  '.lws', '.hmp', '.irrmesh', '.x3d', '.vrml', '.b3dm', '.xyzrgb', '.x3dv',
  '.vtu', '.urdf', '.ugrid', '.su2', '.babylon', '.ac3d', '.bvh', '.ase',
  '.wkt', '.facet'
]);

export function isFormatSupported(filePath) {
  return SUPPORTED_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

export function isGlbFile(filePath) {
  return path.extname(filePath).toLowerCase() === '.glb';
}

export async function convertToGlb(inputPath, outputPath) {
  if (!fs.existsSync(inputPath)) throw new Error(`Input file does not exist: ${inputPath}`);

  const ext = path.extname(inputPath).toLowerCase();
  if (!isFormatSupported(inputPath)) throw new Error(`Unsupported file format: ${ext}`);

  const inputBuffer = fs.readFileSync(inputPath);

  try {
    const assimp = await getAssimp();
    const result = assimp.importFile(inputBuffer, [ext.slice(1)]);
    if (result && result.exportFile) {
      const glbData = result.exportFile('glb2');
      if (glbData && glbData.length > 0) {
        fs.writeFileSync(outputPath, Buffer.from(glbData));
        return;
      }
      const gltfData = result.exportFile('gltf2');
      if (gltfData) {
        await gltfToGlbViaCli(gltfData, outputPath);
        return;
      }
    }
    throw new Error('assimpjs export failed: unsupported export format');
  } catch (err) {
    console.error(`[Converter] assimpjs direct conversion failed: ${err.message}`);
    try {
      const assimp = await getAssimp();
      const result = assimp.importFile(inputBuffer, [ext.slice(1)]);
      const gltfData = result.exportFile('gltf2');
      if (gltfData) {
        await gltfToGlbViaCli(gltfData, outputPath);
        return;
      }
    } catch (fbErr) {
      console.error(`[Converter] glTF fallback also failed: ${fbErr.message}`);
    }
    throw err;
  }
}

// ---- Internal helpers ----

async function gltfToGlbViaCli(gltfData, outputPath) {
  const tmpDir = path.dirname(outputPath);
  const tmpGltfPath = path.join(tmpDir, `_conv_${Date.now()}.gltf`);
  try {
    fs.writeFileSync(tmpGltfPath, Buffer.from(gltfData));
    await runGltfTransform(['copy', tmpGltfPath, outputPath], 120000);
  } finally {
    try { fs.unlinkSync(tmpGltfPath); } catch {}
  }
}

function runGltfTransform(args, timeout = 120000) {
  return new Promise((resolve, reject) => {
    const cmd = getGltfCmd();
    console.error(`[Converter] Using command: ${cmd} ${args.join(' ')}`);
    execFile(cmd, args, { timeout, maxBuffer: 10 * 1024 * 1024, shell: true }, (err, stdout, stderr) => {
      if (stderr) console.error(`[Converter] stderr: ${stderr}`);
      if (stdout) console.error(`[Converter] stdout: ${stdout}`);
      if (err) {
        reject(new Error(`gltf-transform failed: ${stderr || stdout || err.message}`));
      } else {
        resolve(stdout);
      }
    });
  });
}

function getGltfCmd() {
  // 1. Windows: globally npm-installed .cmd
  const localAppData = process.env.LOCALAPPDATA || '';
  const cmdPath = path.join(localAppData, 'npm', 'gltf-transform.cmd');
  if (fs.existsSync(cmdPath)) return cmdPath;

  // 2. Local node_modules/.bin (Linux/macOS/Render)
  const localBin = path.join(process.cwd(), 'node_modules', '.bin', 'gltf-transform');
  if (fs.existsSync(localBin)) return localBin;

  // 3. Fallback: system PATH
  return 'gltf-transform';
}
