/**
 * Shared constants and helpers for the findings staging area layout.
 * Used by both FindingsPlot and ImplementationPlan to keep positioning consistent.
 */

export const STAGING_START_X = 620;  // X position of staging area (right of plot)
export const STAGING_START_Y = 80;   // Y offset from top for staging circles
export const CIRCLES_PER_COLUMN = 9; // Max circles stacked vertically per column
export const COLUMN_WIDTH = 60;      // Horizontal spacing between staging columns
export const ROW_HEIGHT = 55;        // Vertical spacing between circles in a column
export const COMPLETED_Y = 650;      // Y position of completed area (below plot)

/** Return the default staged position for a finding at the given list index */
export const getStagingPosition = (index) => {
  const column = Math.floor(index / CIRCLES_PER_COLUMN);
  const row = index % CIRCLES_PER_COLUMN;
  return {
    x: STAGING_START_X + column * COLUMN_WIDTH,
    y: STAGING_START_Y + row * ROW_HEIGHT,
    staged: true,
    completed: false
  };
};
