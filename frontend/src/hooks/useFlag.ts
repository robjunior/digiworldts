import { useAuth } from './useAuth';

export function useFlag(flag: string): boolean {
  const { flags } = useAuth();
  return flags.includes(flag);
}
