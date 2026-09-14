export interface DesktopRunMapPanelBox {
  x: number;
  width: number;
}

export interface DesktopRunMapPanelColumns {
  region: DesktopRunMapPanelBox;
  planner: DesktopRunMapPanelBox;
}

/** Desktop-only region rail toggle. Collapsing releases the artwork column to
 * the route/destination panel without changing its outer safe bounds. */
export function desktopRunMapPanelColumns(
  content: DesktopRunMapPanelBox,
  expandedPlannerX: number,
  collapsed: boolean,
): DesktopRunMapPanelColumns {
  const right = content.x + content.width;
  if (!collapsed) {
    return {
      region: { x: content.x, width: Math.max(1, expandedPlannerX - content.x - 24) },
      planner: { x: expandedPlannerX, width: Math.max(1, right - expandedPlannerX) },
    };
  }
  const regionWidth = Math.min(180, Math.max(120, content.width * 0.18));
  const plannerX = content.x + regionWidth + 16;
  return {
    region: { x: content.x, width: regionWidth },
    planner: { x: plannerX, width: Math.max(1, right - plannerX) },
  };
}
