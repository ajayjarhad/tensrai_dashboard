import type { User } from '@tensrai/shared';

export interface NavigationService {
  navigateAfterLogin: (user: User) => void;
  navigateToLogin: () => void;
  navigateToDashboard: () => void;
  navigateToUnauthorized: () => void;
}

let navigationService: NavigationService | null = null;

// 'lost': this browser's session no longer works. 'password-setup': it works, but a new password
// has to be set first. Registered by the auth store, which the API client can't import directly.
export type SessionRejection = 'lost' | 'password-setup';

let sessionRejectedHandler: ((rejection: SessionRejection) => void) | null = null;

export const setSessionRejectedHandler = (handler: (rejection: SessionRejection) => void) => {
  sessionRejectedHandler = handler;
};

export const notifySessionRejected = (rejection: SessionRejection) => {
  sessionRejectedHandler?.(rejection);
};

export const setNavigationService = (service: NavigationService) => {
  navigationService = service;
};

export const navigateAfterLogin = (user: User) => {
  if (navigationService) {
    navigationService.navigateAfterLogin(user);
  }
};

export const navigateToLogin = () => {
  if (navigationService) {
    navigationService.navigateToLogin();
  }
};

export const navigateToDashboard = () => {
  if (navigationService) {
    navigationService.navigateToDashboard();
  }
};

export const navigateToUnauthorized = () => {
  if (navigationService) {
    navigationService.navigateToUnauthorized();
  }
};
