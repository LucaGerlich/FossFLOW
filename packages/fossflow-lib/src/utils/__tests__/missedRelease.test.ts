import { Mouse, SlimMouseEvent } from 'src/types';
import { CoordsUtils } from 'src/utils';
import { getMissedMouseUp } from '../renderer';

const pressed: Mouse = {
  position: { screen: { x: 10, y: 10 }, tile: CoordsUtils.zero() },
  delta: null,
  mousedown: { screen: { x: 10, y: 10 }, tile: CoordsUtils.zero() }
};

const released: Mouse = { ...pressed, mousedown: null };

const move = (buttons: number | undefined): SlimMouseEvent => {
  return {
    type: 'mousemove',
    clientX: 120,
    clientY: 80,
    target: null,
    button: 0,
    buttons,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    preventDefault: () => {}
  };
};

describe('getMissedMouseUp', () => {
  test('turns a move with no button held into the release that never arrived', () => {
    const mouseUp = getMissedMouseUp(move(0), pressed);

    expect(mouseUp).toMatchObject({ type: 'mouseup', clientX: 120, clientY: 80 });
  });

  test('ignores moves while a button is still held', () => {
    expect(getMissedMouseUp(move(4), pressed)).toBeNull();
  });

  test('ignores moves when no press is in progress', () => {
    expect(getMissedMouseUp(move(0), released)).toBeNull();
  });

  test('ignores touch moves, which carry no button state', () => {
    expect(getMissedMouseUp(move(undefined), pressed)).toBeNull();
  });

  test('ignores events other than moves', () => {
    expect(getMissedMouseUp({ ...move(0), type: 'mousedown' }, pressed)).toBeNull();
  });
});
