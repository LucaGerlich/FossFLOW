import React from 'react';
import { act, renderHook } from '@testing-library/react';
import { ModelProvider } from 'src/stores/modelStore';
import { SceneProvider } from 'src/stores/sceneStore';
import { UiStateProvider, useUiStateStoreApi } from 'src/stores/uiStateStore';
import { useInteractionManager } from '../useInteractionManager';

const MIDDLE_BUTTON = 1;
const MIDDLE_HELD = 4;
const FRAME_MS = 16;

class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const Wrapper = ({ children }: { children: React.ReactNode }) => {
  return (
    <ModelProvider>
      <SceneProvider>
        <UiStateProvider>{children}</UiStateProvider>
      </SceneProvider>
    </ModelProvider>
  );
};

const setup = () => {
  const { result } = renderHook(
    () => {
      return { manager: useInteractionManager(), uiState: useUiStateStoreApi() };
    },
    { wrapper: Wrapper }
  );

  act(() => {
    result.current.manager.setInteractionsElement(document.createElement('div'));
    result.current.uiState.getState().actions.setEditorMode('EDITABLE');
  });

  return result.current.uiState;
};

const fire = (type: string, x: number, y: number, buttons: number) => {
  act(() => {
    window.dispatchEvent(
      new MouseEvent(type, { clientX: x, clientY: y, button: MIDDLE_BUTTON, buttons })
    );
    jest.advanceTimersByTime(FRAME_MS);
  });
};

describe('useInteractionManager panning', () => {
  beforeAll(() => {
    global.ResizeObserver = NoopResizeObserver as unknown as typeof ResizeObserver;
  });

  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('a middle-button drag moves the canvas exactly as far as the mouse', () => {
    const uiState = setup();

    fire('mousemove', 100, 100, 0);
    fire('mousedown', 100, 100, MIDDLE_HELD);
    for (let step = 1; step <= 10; step++) {
      fire('mousemove', 100 + step * 10, 100 + step * 5, MIDDLE_HELD);
    }
    fire('mouseup', 200, 150, 0);

    expect(uiState.getState().scroll.position).toEqual({ x: 100, y: 50 });
    expect(uiState.getState().mode.type).toBe('CURSOR');
  });

  test('a pan released outside the page ends on the next buttonless move', () => {
    const uiState = setup();

    fire('mousedown', 100, 100, MIDDLE_HELD);
    fire('mousemove', 60, 100, MIDDLE_HELD);
    // The mouseup happened outside the page and never arrives.
    fire('mousemove', 80, 100, 0);
    fire('mousemove', 140, 100, 0);

    expect(uiState.getState().scroll.position).toEqual({ x: -40, y: 0 });
    expect(uiState.getState().mode.type).toBe('CURSOR');
  });
});
