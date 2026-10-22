/**
 * Real React Three Fiber scenes for Collaborative graph + Deploy lifeform.
 * Loaded via esm.sh (no PXN React build required).
 */
import React, { useMemo, useRef, useState } from 'https://esm.sh/react@18.3.1';
import { createRoot } from 'https://esm.sh/react-dom@18.3.1/client';
import { Canvas, useFrame } from 'https://esm.sh/@react-three/fiber@8.17.10?deps=react@18.3.1,react-dom@18.3.1,three@0.170.0';
import { OrbitControls, Html, Line } from 'https://esm.sh/@react-three/drei@9.117.3?deps=react@18.3.1,react-dom@18.3.1,three@0.170.0,@react-three/fiber@8.17.10';

const roots = new Map();

function NodeMesh({ position, label, color = '#22d3ee', selected, onSelect }) {
  const ref = useRef();
  useFrame((_state, delta) => {
    if (ref.current) ref.current.rotation.y += delta * (selected ? 1.2 : 0.35);
  });
  return React.createElement(
    'group',
    { position },
    React.createElement(
      'mesh',
      {
        ref,
        onClick: (event) => {
          event.stopPropagation();
          onSelect?.(label);
        },
        castShadow: true,
      },
      React.createElement('boxGeometry', { args: [0.9, 0.9, 0.9] }),
      React.createElement('meshStandardMaterial', {
        color: selected ? '#f59e0b' : color,
        metalness: 0.35,
        roughness: 0.35,
        emissive: selected ? '#b45309' : '#0e7490',
        emissiveIntensity: 0.35,
      }),
    ),
    React.createElement(
      Html,
      { center: true, distanceFactor: 8, style: { pointerEvents: 'none' } },
      React.createElement(
        'div',
        {
          style: {
            color: '#e2e8f0',
            fontSize: '11px',
            whiteSpace: 'nowrap',
            background: 'rgba(15,23,42,0.75)',
            padding: '2px 6px',
            borderRadius: '6px',
            border: '1px solid rgba(34,211,238,0.35)',
          },
        },
        label,
      ),
    ),
  );
}

function CollabGraph({ labels }) {
  const [selected, setSelected] = useState(null);
  const nodes = useMemo(() => ([
    { label: labels.intent, position: [-2.2, 0.4, 0], color: '#22d3ee' },
    { label: labels.twin, position: [0, 1.1, 0.4], color: '#818cf8' },
    { label: labels.agent, position: [2.1, 0.2, -0.3], color: '#34d399' },
    { label: labels.deploy, position: [0.4, -1.1, 0.6], color: '#f59e0b' },
  ]), [labels]);

  return React.createElement(
    React.Fragment,
    null,
    React.createElement('ambientLight', { intensity: 0.55 }),
    React.createElement('directionalLight', { position: [4, 6, 2], intensity: 1.1 }),
    React.createElement(Line, {
      points: [[-2.2, 0.4, 0], [0, 1.1, 0.4], [2.1, 0.2, -0.3], [0.4, -1.1, 0.6], [-2.2, 0.4, 0]],
      color: '#334155',
      lineWidth: 1,
    }),
    nodes.map((node) => React.createElement(NodeMesh, {
      key: node.label,
      ...node,
      selected: selected === node.label,
      onSelect: setSelected,
    })),
    React.createElement(OrbitControls, { enablePan: true, maxDistance: 12, minDistance: 3 }),
  );
}

function LifeformAssembly({ spinning }) {
  const group = useRef();
  useFrame((_state, delta) => {
    if (group.current && spinning) group.current.rotation.y += delta * 0.6;
  });
  return React.createElement(
    'group',
    { ref: group },
    React.createElement('ambientLight', { intensity: 0.5 }),
    React.createElement('spotLight', { position: [5, 8, 3], angle: 0.4, penumbra: 0.5, intensity: 1.2 }),
    React.createElement(
      'mesh',
      { position: [0, -0.15, 0] },
      React.createElement('cylinderGeometry', { args: [0.7, 0.9, 0.35, 24] }),
      React.createElement('meshStandardMaterial', { color: '#1e293b', metalness: 0.5, roughness: 0.4 }),
    ),
    React.createElement(
      'mesh',
      { position: [0, 0.55, 0] },
      React.createElement('boxGeometry', { args: [1.1, 0.9, 0.55] }),
      React.createElement('meshStandardMaterial', { color: '#22d3ee', metalness: 0.4, roughness: 0.25, transparent: true, opacity: 0.92 }),
    ),
    React.createElement(
      'mesh',
      { position: [-0.85, 0.55, 0], rotation: [0, 0, 0.4] },
      React.createElement('boxGeometry', { args: [0.55, 0.2, 0.2] }),
      React.createElement('meshStandardMaterial', { color: '#818cf8' }),
    ),
    React.createElement(
      'mesh',
      { position: [0.85, 0.55, 0], rotation: [0, 0, -0.4] },
      React.createElement('boxGeometry', { args: [0.55, 0.2, 0.2] }),
      React.createElement('meshStandardMaterial', { color: '#818cf8' }),
    ),
    React.createElement(
      'mesh',
      { position: [0, 1.2, 0] },
      React.createElement('sphereGeometry', { args: [0.28, 24, 24] }),
      React.createElement('meshStandardMaterial', { color: '#f59e0b', emissive: '#b45309', emissiveIntensity: 0.4 }),
    ),
    React.createElement(OrbitControls, { enablePan: false, maxDistance: 10, minDistance: 2.5 }),
  );
}

function SceneShell({ children }) {
  return React.createElement(
    Canvas,
    {
      camera: { position: [0, 1.4, 5.2], fov: 42 },
      dpr: [1, 1.75],
      style: { width: '100%', height: '100%', borderRadius: '10px', background: 'radial-gradient(circle at 40% 20%, #1e293b, #0b1220)' },
      gl: { antialias: true },
    },
    children,
  );
}

export function mountCollabScene(container, labels) {
  if (!container) return;
  let root = roots.get(container);
  if (!root) {
    root = createRoot(container);
    roots.set(container, root);
  }
  root.render(React.createElement(SceneShell, null, React.createElement(CollabGraph, { labels })));
}

export function mountLifeformScene(container, { spinning = true } = {}) {
  if (!container) return;
  let root = roots.get(container);
  if (!root) {
    root = createRoot(container);
    roots.set(container, root);
  }
  root.render(React.createElement(SceneShell, null, React.createElement(LifeformAssembly, { spinning })));
}

export function unmountScene(container) {
  const root = roots.get(container);
  if (root) {
    root.unmount();
    roots.delete(container);
  }
}
