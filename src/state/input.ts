/* Touch input state: whether this device is being used by touch, and the on-screen modifier keys that stand
   in for ⇧, ⌥ and ⌘ when there is no keyboard. Tools read modifiers through their pointer events. */
import { create } from 'zustand';

export type InputState = {
  /** A finger or pen has been used here (or the device's main pointer is coarse). */
  touch: boolean;
  shift: boolean;
  alt: boolean;
  mod: boolean;
};

const coarse = () => typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches;

export const useInput = create<InputState>(() => ({ touch: coarse(), shift: false, alt: false, mod: false }));

export const getInput = useInput.getState;

export function toggleModifier(key: 'shift' | 'alt' | 'mod') {
  useInput.setState((s) => ({ [key]: !s[key] }));
}

export function markTouch() {
  if (!getInput().touch) useInput.setState({ touch: true });
}

/** Hit areas grow under a finger: pointer tolerances are multiplied by this for touch input. */
export const TOUCH_TOLERANCE = 2.5;

let lastPointerType = 'mouse';
export const setPointerType = (t: string) => void (lastPointerType = t);
/** Tolerance multiplier for the pointer that is acting now (fingers are imprecise; pens and mice are not). */
export const toleranceScale = () => (lastPointerType === 'touch' ? TOUCH_TOLERANCE : 1);
