import type { E2EConfig } from "e2e";
import { web } from "@e2e-dev/web";
export default {
 tests:"tests/e2e/**/*.e2e.ts", workers:1, retries:0, timeout:60_000,
 targets:[{name:"chromium",engine:web(),app:{url:"http://127.0.0.1:4180",command:{executable:"npm",args:["run","preview","--","--host","127.0.0.1","--port","4180","--strictPort"]}}}],
} satisfies E2EConfig;
