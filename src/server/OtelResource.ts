import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from "@opentelemetry/semantic-conventions";
import { BRAND } from "../brand/Brand";
import { ServerEnv } from "./ServerEnv";

/** Prefix for the custom resource attributes and metric names. */
export const ATTR_PREFIX = BRAND.telemetry.attributePrefix;

export function getOtelResource() {
  return resourceFromAttributes({
    [ATTR_SERVICE_NAME]: BRAND.telemetry.serviceName,
    [ATTR_SERVICE_VERSION]: "1.0.0",
    ...getPromLabels(),
  });
}

export function getPromLabels() {
  const workerId = ServerEnv.workerId();
  return {
    "service.instance.id": ServerEnv.hostname(),
    [`${ATTR_PREFIX}.environment`]: ServerEnv.env(),
    [`${ATTR_PREFIX}.host`]: ServerEnv.host(),
    [`${ATTR_PREFIX}.domain`]: ServerEnv.domain(),
    [`${ATTR_PREFIX}.subdomain`]: ServerEnv.subdomain(),
    [`${ATTR_PREFIX}.component`]:
      workerId !== undefined ? "Worker " + workerId : "Master",
  };
}
