import { Server as HttpServer } from 'http';
import { Server as SocketIOServer, Socket } from 'socket.io';
import { logger } from '@/utils/logger';

/**
 * Thin wrapper around Socket.io.
 * Each authenticated user joins a private room named after their userId
 * so targeted notifications are trivial: io.to(userId).emit(...).
 *
 * Callers import `socketService` and call `.emit(userId, event, payload)`.
 */
class SocketService {
  private io: SocketIOServer | null = null;

  /** Call once from server.ts after the http.Server is created. */
  init(httpServer: HttpServer, corsOrigins: string[]): void {
    this.io = new SocketIOServer(httpServer, {
      cors: {
        origin: corsOrigins,
        methods: ['GET', 'POST'],
        credentials: true,
      },
      transports: ['websocket', 'polling'],
    });

    this.io.on('connection', (socket: Socket) => {
      const userId = socket.handshake.auth?.userId as string | undefined;

      if (!userId) {
        socket.disconnect(true);
        return;
      }

      socket.join(userId);
      logger.info(`Socket connected`, { socketId: socket.id, userId });

      socket.on('disconnect', (reason) => {
        logger.info(`Socket disconnected`, { socketId: socket.id, userId, reason });
      });
    });

    logger.info('Socket.io initialized');
  }

  /** Emit an event to a specific user (by their MongoDB _id string). */
  emit(userId: string, event: string, payload: unknown): void {
    if (!this.io) {
      logger.warn('SocketService.emit called before init', { userId, event });
      return;
    }
    this.io.to(userId).emit(event, payload);
  }

  /** Emit to multiple users at once. */
  emitToMany(userIds: string[], event: string, payload: unknown): void {
    for (const id of userIds) {
      this.emit(id, event, payload);
    }
  }
}

export const socketService = new SocketService();
