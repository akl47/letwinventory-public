// Harness canvas utilities - main entry point
// This module provides all the drawing and hit-testing functions for the harness canvas

// Re-export constants
export * from './constants';

// Re-export types
export * from './types';

// Re-export drawing utilities
export {
  roundRect,
  drawExpandButton,
  measureTextWidth,
  calculateMaxLabelWidth
} from './drawing-utils';

// Re-export transform utilities
export * from './transform-utils';

// Re-export element functions (connector, cable, component)
export * from './elements';

// Re-export wire functions (includes drawPinHighlight)
export * from './wire';

// Re-export grid functions
export * from './grid';

// Re-export wire color map
export * from './wire-color-map';
