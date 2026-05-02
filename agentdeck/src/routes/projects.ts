import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { db } from "../db/index.js";
import { projects } from "../db/schema.js";
import { eq, desc } from "drizzle-orm";
import { existsSync } from "node:fs";

const AUTH_ROUTES = new Set(["/api/projects", "/api/projects/"]);

export async function projectRoutes(fastify: FastifyInstance) {
  fastify.addHook("onRequest", async (req: FastifyRequest, reply: FastifyReply) => {
    const path = req.url.split("?")[0];
    if (!AUTH_ROUTES.has(path) && !path.startsWith("/api/projects/")) return;

    if (!req.cookies.ad_session) {
      return reply.status(401).send({ ok: false, error: "unauthorized" });
    }
    const sessions = (fastify as any).sessions;
    if (!sessions?.has(req.cookies.ad_session)) {
      return reply.status(401).send({ ok: false, error: "unauthorized" });
    }
  });

  fastify.get("/api/projects", async () => {
    const all = await db.select().from(projects).orderBy(desc(projects.updatedAt));
    return all;
  });

  fastify.get("/api/projects/:id", async (request) => {
    const { id } = request.params as { id: string };
    const project = await db.select().from(projects).where(eq(projects.id, Number(id))).limit(1);
    return project[0] || null;
  });

  fastify.post("/api/projects", async (request) => {
    const { name, path, stack, preferredAgent, notes } = request.body as {
      name: string;
      path: string;
      stack?: string;
      preferredAgent?: string;
      notes?: string;
    };

    if (!existsSync(path)) {
      throw { statusCode: 400, message: "Path does not exist" };
    }

    const existing = await db.select().from(projects).where(eq(projects.path, path)).limit(1);
    if (existing.length) {
      throw { statusCode: 409, message: "Project already exists" };
    }

    const result = await db.insert(projects).values({
      name,
      path,
      stack,
      preferredAgent,
      notes,
    });

    return { id: Number(result.lastInsertRowid), name, path };
  });

  fastify.patch("/api/projects/:id", async (request) => {
    const { id } = request.params as { id: string };
    const updates = request.body as Partial<typeof projects.$inferInsert>;

    await db.update(projects)
      .set({ ...updates })
      .where(eq(projects.id, Number(id)));

    return { success: true };
  });

  fastify.delete("/api/projects/:id", async (request) => {
    const { id } = request.params as { id: string };
    await db.delete(projects).where(eq(projects.id, Number(id)));
    return { success: true };
  });
}