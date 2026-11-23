// Every signed-in page loads from here, inside the app shell's chunk. Pages only ever open within the
// shell, and importing them from its chunk tells Rollup so: what they share with the shell stays in
// the shell's chunk instead of being split into many small ones that each page then fetches.
export const pages = {
  dashboard: () => import('@/features/robot-map/components/Dashboard'),
  robots: () => import('@/features/admin/components/RobotManagement'),
  users: () => import('@/features/admin/components/user-management'),
  newUser: () => import('@/features/admin/components/user-creation'),
  organizations: () => import('@/features/staff/components/OrganizationsPage'),
  mapList: () => import('@/features/maps/MapListPage'),
  mapEditor: () => import('@/features/maps/editor/MapEditorPage'),
  mapMerge: () => import('@/features/maps/merge/MergePage'),
};
