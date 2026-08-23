import { http, HttpResponse } from "msw";
import { SERVICES } from "../seededDataset";
import type { ServicesData } from "../../services";

export const servicesHandlers = [
  http.get("/api/services", () => {
    const body: ServicesData = { services: SERVICES };
    return HttpResponse.json(body);
  }),
];
