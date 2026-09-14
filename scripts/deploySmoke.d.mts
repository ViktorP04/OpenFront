export function checkDeployment(
  origin: string,
  options?: {
    expectedCommit?: string;
    maps?: string[];
    fetcher?: (url: URL, options: RequestInit) => Promise<Response>;
  },
): Promise<{
  commit: string;
  maps: string[];
  registrationCodeRequired: boolean;
}>;
