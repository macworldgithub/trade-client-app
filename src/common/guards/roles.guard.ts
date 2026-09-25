import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '../enums/roles.enum';
import { ROLES_KEY } from '../decorators/roles.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const { user } = context.switchToHttp().getRequest();
    if (!user || !user.role) {
      throw new ForbiddenException(
        'You do not have permission to access this resource',
      );
    }

    const userRole = user.role as Role;

    // Admin has access to all protected endpoints
    if (userRole === Role.ADMIN || userRole === Role.GROUP_ADMIN || userRole === Role.CSUITES) {
      return true;
    }

    // Check exact match
    if (requiredRoles.includes(userRole)) {
      return true;
    }

    // If endpoint requires controller or legacy controller roles, match controller
    const controllerRoles = [Role.CONTROLLER, Role.PARTS_CONTROLLER, Role.STORE_MANAGER];
    const isControllerRequired = requiredRoles.some((r) => controllerRoles.includes(r));
    const isUserRoleController = controllerRoles.includes(userRole);

    if (isControllerRequired && isUserRoleController) {
      return true;
    }

    throw new ForbiddenException(
      'You do not have permission to access this resource',
    );
  }
}
