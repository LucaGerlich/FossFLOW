import { useCallback, useEffect, useState } from 'react';
import { useUiStateStore } from 'src/stores/uiStateStore';
import { useTraffic } from './TrafficContext';

export type TrafficSelection =
  | { type: 'arrow'; connectorId: string }
  | { type: 'box'; itemId: string };

export interface TrafficSelectionState {
  selection: TrafficSelection | null;
  select: (next: TrafficSelection) => void;
  close: () => void;
  /** True outside the editor, where the overlay supplies its own hit areas. */
  readOnly: boolean;
}

/**
 * The open traffic card. In the editor it follows the editor's selection (an
 * arrow carrying traffic, or a bound box); elsewhere it is local state that
 * the overlay's hit areas set.
 */
export const useTrafficSelection = (): TrafficSelectionState => {
  const traffic = useTraffic();
  const editorMode = useUiStateStore((state) => state.editorMode);
  const itemControls = useUiStateStore((state) => state.itemControls);
  const setItemControls = useUiStateStore(
    (state) => state.actions.setItemControls
  );
  const [local, setLocal] = useState<TrafficSelection | null>(null);
  const readOnly = editorMode !== 'EDITABLE';

  let selection: TrafficSelection | null = null;
  if (readOnly) {
    selection = local;
  } else if (traffic && itemControls && 'id' in itemControls) {
    if (itemControls.type === 'CONNECTOR' && traffic.arrows.has(itemControls.id)) {
      selection = { type: 'arrow', connectorId: itemControls.id };
    } else if (
      itemControls.type === 'ITEM' &&
      traffic.index.boxes.some((box) => box.itemId === itemControls.id)
    ) {
      selection = { type: 'box', itemId: itemControls.id };
    }
  }

  const select = useCallback(
    (next: TrafficSelection) => {
      if (readOnly) setLocal(next);
    },
    [readOnly]
  );
  const close = useCallback(() => {
    if (readOnly) setLocal(null);
    else setItemControls(null);
  }, [readOnly, setItemControls]);

  const open = selection !== null;
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, close]);

  return { selection, select, close, readOnly };
};
