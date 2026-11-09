import React, { useMemo } from 'react';
import { DS_COLORS } from 'src/styles/tokens';
import { useUiStateStore } from 'src/stores/uiStateStore';
import { createSmoothPath } from 'src/utils';

export const FreehandLasso = () => {
  const modeType = useUiStateStore((state) => state.mode.type);
  const path = useUiStateStore((state) =>
    state.mode.type === 'FREEHAND_LASSO' ? state.mode.path : []
  );
  const rendererEl = useUiStateStore((state) => state.rendererEl);

  const rendererSize = rendererEl?.getBoundingClientRect();

  const smoothPath = useMemo(() => {
    if (modeType !== 'FREEHAND_LASSO' || path.length < 2) {
      return '';
    }
    return createSmoothPath(path);
  }, [modeType, path]);

  if (modeType !== 'FREEHAND_LASSO' || path.length < 2) {
    return null;
  }

  const width = rendererSize?.width || 0;
  const height = rendererSize?.height || 0;

  return (
    <svg
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex: 1000
      }}
      viewBox={`0 0 ${width} ${height}`}
    >
      <path
        d={smoothPath}
        fill="rgba(0, 112, 243, 0.08)"
        stroke={DS_COLORS.link}
        strokeWidth={2}
        strokeDasharray="8 4"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
};
