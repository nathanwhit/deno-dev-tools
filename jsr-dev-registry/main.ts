import { Hono } from "@hono/hono";
import { logger } from "@hono/hono/logger";
import type * as types from "./types.ts";
import { join } from "@std/path/posix";

type JsrPackageInfoVersion = {
  yanked?: boolean;
};

type JsrPackageInfo = {
  versions: Record<string, JsrPackageInfoVersion>;
};

type JsrPackageVersionInfo = {
  exports: Record<string, string>;
  manifest: Record<string, object>;
};

type DevPackage = {
  versions: Mappy<string, JsrPackageVersionInfo & JsrPackageInfoVersion>;
};

function newDevPackage(): DevPackage {
  return {
    versions: new Mappy(),
  };
}

class Mappy<K, V> extends Map<K, V> {
  getOrCreate(key: K, fallback: () => V): V {
    if (this.has(key)) {
      return this.get(key) as V;
    }
    this.set(key, fallback());
    return this.get(key)!;
  }
}

class Scope {
  packages: Mappy<string, DevPackage> = new Mappy();
}

class DevPackages {
  scopes: Mappy<string, Scope> = new Mappy();

  getScope(scope: string): Scope {
    return this.scopes.getOrCreate(scope, () => new Scope());
  }
}

const store = new DevPackages();

const app = new Hono();

app.use(logger());

const client = Deno.createHttpClient({});

// app.get("/:scope/:name/meta.json", async (c) => {
//   return c.json({});
// });

type Resp = types.components["schemas"]["Scope"];

type ApiResponses<Api extends keyof types.paths, Op extends "get" | "post"> =
  types.paths[Api][Op] extends undefined ? never
    : "responses" extends keyof types.paths[Api][Op]
      ? types.paths[Api][Op]["responses"]
    : never;

type Foo = ApiResponses<"/scopes/{scope}", "get">;

// app.get("/api/scopes/:scope", async (c) => {
//   return c.json({});
// });
//

type PublishVersion = Omit<
  ApiResponses<
    "/scopes/{scope}/packages/{package}/versions/{version}",
    "post"
  >["200"]["content"]["application/json"],
  "userId"
>;
app.post(
  "/api/scopes/:scope/packages/:package/versions/:version",
  async (c) => {
    console.log(c.req.query());
    const packageName = c.req.param("package");
    const scope = c.req.param("scope");
    const version = c.req.param("version");
    const tarball = await c.req.blob();

    const pkg = store.getScope(scope).packages.getOrCreate(
      packageName,
      newDevPackage,
    );

    // pkg.versions.getOrCreate(version, () => {
    // });

    return c.json(
      {
        id: "asdf",
        status: "success",
        error: null,
        createdAt: new Date().toString(),
        packageName,
        packageScope: scope,
        packageVersion: version,
        updatedAt: new Date().toString(),
      } satisfies PublishVersion,
    );
  },
);

const base = new URL("https://jsr.io/");

app.get("/*", async (c) => {
  const real = new URL(base);
  real.pathname = c.req.path;
  const response = await fetch(real);
  const json = await response.json();
  console.log(json);
  return c.json(json);
});

Deno.serve(app.fetch);
