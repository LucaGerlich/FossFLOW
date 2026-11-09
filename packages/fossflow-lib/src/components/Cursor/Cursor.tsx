import React, { memo } from 'react';
import chroma from 'chroma-js';
import { IsoTileArea } from 'src/components/IsoTileArea/IsoTileArea';
import { useUiStateStore } from 'src/stores/uiStateStore';
import { DS_COLORS } from 'src/styles/tokens';

// Hover tile: interaction semantics use the link-blue tint, like the lasso.
const CURSOR_FILL = chroma(DS_COLORS.link).alpha(0.12).css();

export const Cursor = memo(() => {
  const tile = useUiStateStore((state) => {
    return state.mouse.position.tile;
  });
  const zoom = useUiStateStore((state) => {
    return state.zoom;
  });

  return (
    <IsoTileArea
      from={tile}
      to={tile}
      fill={CURSOR_FILL}
      cornerRadius={10 * zoom}
    />
  );
});
