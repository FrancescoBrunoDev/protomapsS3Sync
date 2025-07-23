import type { Logger } from "./logger.js";

export class HealthServer {
    private server?: any;
    private logger: Logger;

    constructor(logger: Logger) {
        this.logger = logger;
    }

    start(port: number = 80): void {
        try {
            this.server = Bun.serve({
                port,
                fetch: (req) => {
                    const url = new URL(req.url);
                    
                    if (url.pathname === '/health' || url.pathname === '/') {
                        return new Response(JSON.stringify({
                            status: 'healthy',
                            timestamp: new Date().toISOString(),
                            service: 'protomaps-s3-sync'
                        }), {
                            status: 200,
                            headers: {
                                'Content-Type': 'application/json'
                            }
                        });
                    }
                    
                    return new Response('Not Found', { status: 404 });
                },
            });
            
            this.logger.log(`🏥 Health check server started on port ${port}`);
            this.logger.log(`🔍 Health endpoint: http://localhost:${port}/health`);
        } catch (error) {
            if (error instanceof Error && error.message.includes('EADDRINUSE')) {
                // Try alternative ports
                const alternativePorts = [8080, 3000, 8000, 9000];
                for (const altPort of alternativePorts) {
                    try {
                        this.server = Bun.serve({
                            port: altPort,
                            fetch: (req) => {
                                const url = new URL(req.url);
                                
                                if (url.pathname === '/health' || url.pathname === '/') {
                                    return new Response(JSON.stringify({
                                        status: 'healthy',
                                        timestamp: new Date().toISOString(),
                                        service: 'protomaps-s3-sync'
                                    }), {
                                        status: 200,
                                        headers: {
                                            'Content-Type': 'application/json'
                                        }
                                    });
                                }
                                
                                return new Response('Not Found', { status: 404 });
                            },
                        });
                        
                        this.logger.log(`🏥 Health check server started on port ${altPort} (port ${port} was in use)`);
                        this.logger.log(`🔍 Health endpoint: http://localhost:${altPort}/health`);
                        return;
                    } catch (altError) {
                        // Continue to next port
                        continue;
                    }
                }
                
                this.logger.log(`⚠️ Could not start health server - all ports (${port}, ${alternativePorts.join(', ')}) are in use`);
                this.logger.log(`⚠️ Application will continue without health check endpoint`);
            } else {
                this.logger.log(`⚠️ Failed to start health server: ${error instanceof Error ? error.message : String(error)}`);
                this.logger.log(`⚠️ Application will continue without health check endpoint`);
            }
        }
    }

    stop(): void {
        if (this.server) {
            this.server.stop();
            this.logger.log("🏥 Health check server stopped");
        }
    }
}
