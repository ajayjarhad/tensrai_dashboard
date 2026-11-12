import { useQuery } from '@tanstack/react-query';
import { missionsQuery } from '../queries';

export function useRobotMissionsQuery() {
  return useQuery(missionsQuery);
}
