import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "./client";
import type { Service } from "./types";

export interface ServicesData {
  services: Service[];
}

export function fetchServices(): Promise<ServicesData> {
  return apiRequest<ServicesData>("/api/services");
}

// The catalogue has to come from the API, not from a fixture: the ids feed the
// service filter, and every endpoint behind that filter compares them against
// the `services.id` UUID column. A made-up id is a 400, not an empty result.
//
// Services are added about as often as a repository is created, so this is
// fetched once and kept rather than polled like the incident data.
export function useServices() {
  return useQuery({
    queryKey: ["services"],
    queryFn: fetchServices,
    staleTime: Infinity,
  });
}
