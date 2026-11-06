import { getExtension } from '@form3d/shared';
import { importGltfFiles, pickMainModelFile, type ImportResult } from './gltf';
import { importObjFiles } from './obj';

/**
 * 모델 파일 불러오기 진입점. 확장자에 따라 알맞은 로더를 선택합니다.
 * 새 형식(FBX, STL 등)은 여기에 로더를 추가하면 UI 변경 없이 연결됩니다.
 */
export async function importModelFiles(files: File[]): Promise<ImportResult> {
  const main = pickMainModelFile(files);
  switch (getExtension(main.name)) {
    case '.obj':
      return importObjFiles(files);
    default:
      return importGltfFiles(files);
  }
}
