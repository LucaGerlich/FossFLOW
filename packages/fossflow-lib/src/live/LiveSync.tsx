import { useEffect } from 'react';
import { useModelStoreApi } from 'src/stores/modelStore';
import { useSceneStoreApi } from 'src/stores/sceneStore';
import { useUiStateStore } from 'src/stores/uiStateStore';
import type { State } from 'src/stores/reducers/types';
import { syncLiveInventory } from './sync';
import type { LiveSnapshot } from './types';

interface LiveSyncProps {
  snapshot: LiveSnapshot;
}

/**
 * Places newly discovered servers and containers on the current view.
 * Editable mode only: read-only displays never change the diagram.
 * Changes skip undo history (discovery isn't an edit to undo).
 * ponytail: history is snapshot-based, so undoing an older edit can briefly
 * drop an auto-placed item; the next snapshot puts it back.
 */
export const LiveSync = ({ snapshot }: LiveSyncProps) => {
  const editorMode = useUiStateStore((state) => state.editorMode);
  const viewId = useUiStateStore((state) => state.view);
  const modelStoreApi = useModelStoreApi();
  const sceneStoreApi = useSceneStoreApi();

  useEffect(() => {
    if (editorMode !== 'EDITABLE' || !viewId) return;
    const model = modelStoreApi.getState();
    const scene = sceneStoreApi.getState();
    const state: State = {
      model: {
        version: model.version,
        title: model.title,
        description: model.description,
        colors: model.colors,
        icons: model.icons,
        items: model.items,
        views: model.views
      },
      scene: { connectors: scene.connectors, textBoxes: scene.textBoxes }
    };
    try {
      const next = syncLiveInventory(state, viewId, snapshot);
      if (!next) return;
      model.actions.set(next.model, true);
      scene.actions.set(next.scene, true);
    } catch (error) {
      // A malformed diagram must not break the editor; skip this round.
      console.warn('[live] could not place discovered items', error);
    }
  }, [snapshot, editorMode, viewId, modelStoreApi, sceneStoreApi]);

  return null;
};
