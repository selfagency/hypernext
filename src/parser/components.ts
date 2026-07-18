// Re-export all component resolver functionality from resolver.ts
// This file exists for backward compatibility — new code should import from resolver.ts directly
// biome-ignore lint/performance/noBarrelFile: backward compatibility re-exports
export {
  ALLOWED_COMPONENTS,
  COMPONENT_RESOLVERS,
  type ComponentContext,
  type ComponentResolver,
  resolveComponent,
} from "./resolver.js";
