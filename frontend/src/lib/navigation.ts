import type { User } from '@tensrai/shared';

export interface NavigationService {
  navigateAfterLogin: (user: User) => void;
  navigateToLogin: () => void;
  navigateToDashboard: () => void;
  navigateToUnauthorized: () => void;
}

let navigationService: NavigationService | null = null;

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
