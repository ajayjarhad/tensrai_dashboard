import { apiClient } from '@/lib/api';

export interface StaffOrg {
  id: string;
  name: string;
  slug: string;
  users: number;
  robots: number;
  pendingAddresses: number;
}

export type AddressStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export interface StaffAddress {
  id: string;
  ip: string;
  status: AddressStatus;
  orgId: string;
  orgName: string | null;
  requestedBy: string | null;
  robots: string[];
  otherOrgs: Array<{ name: string | null; status: AddressStatus }>;
}

export interface NewAdmin {
  user: { username: string; email: string };
  tempPassword: string;
}

type Envelope<T> = { success: boolean; data: T };

export const getOrgs = async () => (await apiClient.get<Envelope<StaffOrg[]>>('staff/orgs')).data;

export const createOrg = async (input: {
  name: string;
  slug: string;
  username: string;
  email: string;
}) => (await apiClient.post<Envelope<NewAdmin>>('staff/orgs', input)).data;

export const addOrgAdmin = async (orgId: string, input: { username: string; email: string }) =>
  (await apiClient.post<Envelope<NewAdmin>>(`staff/orgs/${orgId}/admins`, input)).data;

export const enterOrg = (orgId: string) => apiClient.post(`staff/orgs/${orgId}/enter`);
export const exitOrg = () => apiClient.post('staff/exit');

export const getAddresses = async () =>
  (await apiClient.get<Envelope<StaffAddress[]>>('staff/addresses')).data;

export const approveAddress = (id: string) => apiClient.post(`staff/addresses/${id}/approve`);
export const rejectAddress = (id: string) => apiClient.post(`staff/addresses/${id}/reject`);
export const releaseAddress = (id: string) => apiClient.delete(`staff/addresses/${id}`);
export const approveAddressAhead = (orgId: string, ip: string) =>
  apiClient.post(`staff/orgs/${orgId}/addresses`, { ip });

export const moveRobot = (robotId: string, orgId: string) =>
  apiClient.post(`staff/robots/${robotId}/move`, { orgId });
