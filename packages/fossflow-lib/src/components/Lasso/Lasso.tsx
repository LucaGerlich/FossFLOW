import React from 'react';
import { DS_COLORS } from 'src/styles/tokens';
import { useUiStateStore } from 'src/stores/uiStateStore';
import { IsoTileArea } from 'src/components/IsoTileArea/IsoTileArea';

export const Lasso = () => {
  const modeType = useUiStateStore((state) => state.mode.type);
  const selection = useUiStateStore((state) =>
    state.mode.type === 'LASSO' ? state.mode.selection : null
  );

  if (modeType !== 'LASSO' || !selection) {
    return null;
  }

  const { startTile, endTile } = selection;

  return (
    <IsoTileArea
      from={startTile}
      to={endTile}
      fill="rgba(0, 112, 243, 0.08)"
      cornerRadius={8}
      stroke={{
        color: DS_COLORS.link,
        width: 2,
        dashArray: '8 4'
      }}
    />
  );
};
