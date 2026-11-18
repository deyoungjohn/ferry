/** Paths of the signed-in app. Public pages live at the root. */
export const APP_BASE = '/app';

export const ROUTES = {
  swap: `${APP_BASE}/swap`,
  swapOrder: (id: string) => `${APP_BASE}/swap/${id}`,
  payLink: `${APP_BASE}/pay-link`,
  sendLink: `${APP_BASE}/pay-link?type=send`,
  activity: `${APP_BASE}/my-activity`,
  recover: `${APP_BASE}/recover`,
  guide: `${APP_BASE}/user-guide`,
} as const;
