import { useRef, type ReactNode } from 'react';
import { GLTF_RESOURCE_EXTENSIONS, OBJ_RESOURCE_EXTENSIONS, SUPPORTED_IMPORT_EXTENSIONS } from '@form3d/shared';
import { Button } from '../ui/Button';
import { importFiles } from '../../lib/actions';
import { useAppStore } from '../../state/appStore';

const ACCEPT = [...new Set([...SUPPORTED_IMPORT_EXTENSIONS, ...GLTF_RESOURCE_EXTENSIONS, ...OBJ_RESOURCE_EXTENSIONS])].join(',');

export function FileImportButton({
  label,
  icon,
  variant = 'subtle',
  className,
}: {
  label: string;
  icon?: ReactNode;
  variant?: 'primary' | 'ghost' | 'subtle';
  className?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const busy = useAppStore((s) => s.busy);
  return (
    <>
      <Button
        variant={variant}
        icon={icon}
        className={className}
        disabled={!!busy}
        onClick={() => ref.current?.click()}
        title=".glb / .gltf / .obj 파일 (.gltf의 .bin·텍스처, .obj의 .mtl·텍스처는 함께 선택)"
      >
        {label}
      </Button>
      <input
        ref={ref}
        type="file"
        multiple
        accept={ACCEPT}
        className="hidden"
        data-testid="file-input"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = '';
          void importFiles(files);
        }}
      />
    </>
  );
}
