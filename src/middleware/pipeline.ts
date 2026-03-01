/**
 * Tul Middleware Pipeline - Orchestrates middleware execution
 *
 * Chains middleware in order, passing context through each one.
 * Supports both beforeRequest and afterResponse phases.
 */

import type { Middleware, RequestContext, ResponseContext } from '../types/index.js';
import { Logger } from '../utils/logger.js';

/**
 * Middleware pipeline orchestrator
 *
 * Manages a collection of middleware and executes them in order
 * for both request and response phases.
 */
export class MiddlewarePipeline {
  private middleware: Middleware[] = [];
  private logger: Logger;

  constructor(logger?: Logger) {
    this.logger = logger ?? new Logger('warn', '[tul:pipeline]');
  }

  /**
   * Add middleware to the pipeline
   */
  add(middleware: Middleware): this {
    this.middleware.push(middleware);
    this.logger.debug(`Added middleware: ${middleware.name}`);
    return this;
  }

  /**
   * Add multiple middleware at once
   */
  addAll(middlewares: Middleware[]): this {
    for (const middleware of middlewares) {
      this.add(middleware);
    }
    return this;
  }

  /**
   * Remove middleware by name
   */
  remove(name: string): boolean {
    const index = this.middleware.findIndex((m) => m.name === name);
    if (index !== -1) {
      this.middleware.splice(index, 1);
      this.logger.debug(`Removed middleware: ${name}`);
      return true;
    }
    return false;
  }

  /**
   * Get all middleware names
   */
  getNames(): string[] {
    return this.middleware.map((m) => m.name);
  }

  /**
   * Get enabled middleware count
   */
  getEnabledCount(): number {
    return this.middleware.filter((m) => m.enabled).length;
  }

  /**
   * Run all beforeRequest middleware in order
   *
   * Chains the middleware, passing the modified context from each
   * to the next. Only runs enabled middleware that implements beforeRequest.
   */
  async runBeforeRequest(context: RequestContext): Promise<RequestContext> {
    let currentContext = context;

    for (const middleware of this.middleware) {
      if (!middleware.enabled) {
        this.logger.debug(`Skipping disabled middleware: ${middleware.name}`);
        continue;
      }

      if (!middleware.beforeRequest) {
        continue;
      }

      try {
        this.logger.debug(`Running beforeRequest: ${middleware.name}`);
        const startTime = performance.now();

        currentContext = await middleware.beforeRequest(currentContext);

        const elapsed = (performance.now() - startTime).toFixed(2);
        this.logger.debug(`${middleware.name} beforeRequest completed in ${elapsed}ms`);
      } catch (error) {
        this.logger.error(`Middleware ${middleware.name} beforeRequest failed:`, error);
        throw error;
      }
    }

    return currentContext;
  }

  /**
   * Run all afterResponse middleware in order
   *
   * Chains the middleware, passing the modified context from each
   * to the next. Only runs enabled middleware that implements afterResponse.
   */
  async runAfterResponse(context: ResponseContext): Promise<ResponseContext> {
    let currentContext = context;

    for (const middleware of this.middleware) {
      if (!middleware.enabled) {
        this.logger.debug(`Skipping disabled middleware: ${middleware.name}`);
        continue;
      }

      if (!middleware.afterResponse) {
        continue;
      }

      try {
        this.logger.debug(`Running afterResponse: ${middleware.name}`);
        const startTime = performance.now();

        currentContext = await middleware.afterResponse(currentContext);

        const elapsed = (performance.now() - startTime).toFixed(2);
        this.logger.debug(`${middleware.name} afterResponse completed in ${elapsed}ms`);

        // Check if middleware requested a retry
        if (currentContext.shouldRetry) {
          this.logger.info(
            `Middleware ${middleware.name} requested retry: ${currentContext.retryReason}`
          );
        }
      } catch (error) {
        this.logger.error(`Middleware ${middleware.name} afterResponse failed:`, error);
        throw error;
      }
    }

    return currentContext;
  }

  /**
   * Enable a middleware by name
   */
  enable(name: string): boolean {
    const middleware = this.middleware.find((m) => m.name === name);
    if (middleware) {
      middleware.enabled = true;
      this.logger.debug(`Enabled middleware: ${name}`);
      return true;
    }
    return false;
  }

  /**
   * Disable a middleware by name
   */
  disable(name: string): boolean {
    const middleware = this.middleware.find((m) => m.name === name);
    if (middleware) {
      middleware.enabled = false;
      this.logger.debug(`Disabled middleware: ${name}`);
      return true;
    }
    return false;
  }

  /**
   * Check if a middleware is enabled
   */
  isEnabled(name: string): boolean {
    const middleware = this.middleware.find((m) => m.name === name);
    return middleware?.enabled ?? false;
  }

  /**
   * Clear all middleware
   */
  clear(): void {
    this.middleware = [];
    this.logger.debug('Cleared all middleware');
  }

  /**
   * Get middleware by name
   */
  get(name: string): Middleware | undefined {
    return this.middleware.find((m) => m.name === name);
  }

  /**
   * Get count of middleware
   */
  get count(): number {
    return this.middleware.length;
  }
}

export default MiddlewarePipeline;
