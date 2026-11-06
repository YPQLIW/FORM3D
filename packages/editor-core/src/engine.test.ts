import { describe, expect, it } from 'vitest';
import type { Mesh } from 'three';
import {
  AddObjectCommand,
  ChangeMaterialCommand,
  EditorEngine,
  RemoveObjectCommand,
  RenameObjectCommand,
  SetTransformCommand,
  computeStats,
  createPrimitive,
  readMaterial,
  readTransform,
  validateGltfContent,
} from './index';

describe('EditorEngine + commands', () => {
  it('adds, removes and restores objects with undo/redo', () => {
    const e = new EditorEngine();
    const box = createPrimitive('box');
    e.execute(new AddObjectCommand(box));
    expect(e.root.children).toContain(box);
    expect(e.getSelectedId()).toBe(box.uuid);

    e.execute(new RemoveObjectCommand(box));
    expect(e.root.children).not.toContain(box);
    expect(e.getSelectedId()).toBeNull();

    e.undo();
    expect(e.root.children).toContain(box);
    e.undo();
    expect(e.root.children).not.toContain(box);
    e.redo();
    expect(e.root.children).toContain(box);
  });

  it('restores child order on undo of remove', () => {
    const e = new EditorEngine();
    const a = createPrimitive('box', 'A');
    const b = createPrimitive('sphere', 'B');
    const c = createPrimitive('cone', 'C');
    [a, b, c].forEach((o) => e.execute(new AddObjectCommand(o)));
    e.execute(new RemoveObjectCommand(b));
    e.undo();
    expect(e.root.children.map((o) => o.name)).toEqual(['A', 'B', 'C']);
  });

  it('applies transform, material and rename with undo', () => {
    const e = new EditorEngine();
    const m = createPrimitive('sphere') as Mesh;
    e.execute(new AddObjectCommand(m));

    const before = readTransform(m);
    const after = { ...before, position: [1, 2, 3] as [number, number, number] };
    e.execute(new SetTransformCommand(m, before, after));
    expect(m.position.toArray()).toEqual([1, 2, 3]);
    e.undo();
    expect(m.position.toArray()).toEqual(before.position);

    e.execute(new ChangeMaterialCommand(m, { color: '#ff0000', metalness: 0.8, roughness: 2 }));
    expect(readMaterial(m)).toEqual({ color: '#ff0000', metalness: 0.8, roughness: 1 });
    e.undo();
    expect(readMaterial(m).color).toBe('#9aa4b5');

    e.execute(new RenameObjectCommand(m, 'Ball'));
    expect(m.name).toBe('Ball');
    e.undo();
    expect(m.name).toBe('Sphere');
  });

  it('rejects invalid values', () => {
    const m = createPrimitive('box') as Mesh;
    expect(() => new ChangeMaterialCommand(m, { color: 'red' })).toThrow();
    const t = readTransform(m);
    expect(() => new SetTransformCommand(m, t, { ...t, scale: [NaN, 1, 1] })).toThrow();
  });

  it('generates unique names and computes stats', () => {
    const e = new EditorEngine();
    e.execute(new AddObjectCommand(createPrimitive('box', e.uniqueName('Box'))));
    expect(e.uniqueName('Box')).toBe('Box.001');
    const s = computeStats(e.root);
    expect(s.meshes).toBe(1);
    expect(s.vertices).toBe(24);
    expect(s.triangles).toBe(12);
    expect(s.size?.map((v) => Math.round(v))).toEqual([1, 1, 1]);
  });
});

describe('glTF validation', () => {
  it('rejects non-GLB data', () => {
    expect(() => validateGltfContent('a.glb', new ArrayBuffer(4))).toThrow(/손상/);
    const bad = new Uint8Array(20);
    expect(() => validateGltfContent('a.glb', bad.buffer)).toThrow(/시그니처/);
  });
  it('checks gltf json version', () => {
    const enc = new TextEncoder();
    expect(() =>
      validateGltfContent('a.gltf', enc.encode('{"asset":{"version":"1.0"}}').buffer as ArrayBuffer),
    ).toThrow(/2\.0/);
    expect(() =>
      validateGltfContent('a.gltf', enc.encode('{"asset":{"version":"2.0"}}').buffer as ArrayBuffer),
    ).not.toThrow();
  });
});
