import { AuthService } from './auth.service';
import { Role } from '../common/enums/roles.enum';
import * as bcrypt from 'bcrypt';

describe('Native authentication', () => {
  let service: AuthService;
  let users: any;
  let sessions: any;
  let audit: any;
  const dto = { email: 'USER@example.com', fullName: 'Test User', password: 'a-long-password-123' };

  beforeEach(() => {
    users = { exists: jest.fn().mockResolvedValue(null), create: jest.fn(), findOne: jest.fn(), findById: jest.fn() };
    sessions = { create: jest.fn(), updateMany: jest.fn(), findOneAndUpdate: jest.fn(), updateOne: jest.fn() };
    audit = { create: jest.fn() };
    service = new AuthService(users, audit, sessions, { signAsync: jest.fn().mockResolvedValue('signed-access-token') } as any, { assertConfigured: jest.fn(), send: jest.fn() } as any, {} as any);
  });

  it('hashes passwords and creates only unassigned trade partners', async () => {
    users.create.mockImplementation(async (input: any) => ({ ...input, _id: 'user-id' }));
    await service.register(dto);
    const stored = users.create.mock.calls[0][0];
    expect(stored.email).toBe('user@example.com');
    expect(stored.role).toBe(Role.TRADE_PARTNER);
    expect(stored.tradeAccountId).toBeNull();
    expect(stored.password).toBeUndefined();
    expect(await bcrypt.compare(dto.password, stored.passwordHash)).toBe(true);
  });

  it('rejects public role and account escalation', async () => {
    await expect(service.register({ ...dto, role: Role.ADMIN })).rejects.toThrow('trade partners only');
    await expect(service.register({ ...dto, tradeAccountId: 'another-account' })).rejects.toThrow('trade partners only');
    expect(users.create).not.toHaveBeenCalled();
  });

  it('rejects short and bcrypt-truncated passwords', async () => {
    await expect(service.register({ ...dto, password: 'short' })).rejects.toThrow('12 characters');
    await expect(service.register({ ...dto, password: 'é'.repeat(40) })).rejects.toThrow('72 UTF-8 bytes');
  });

  it('does not overwrite an existing account', async () => {
    users.exists.mockResolvedValue({ _id: 'old-user' });
    await expect(service.register(dto)).rejects.toThrow('already registered');
    expect(users.create).not.toHaveBeenCalled();
  });

  it('rejects inactive users even with a correct password', async () => {
    const passwordHash = await bcrypt.hash(dto.password, 4);
    users.findOne.mockReturnValue({ select: jest.fn().mockResolvedValue({ passwordHash, isActive: false }) });
    await expect(service.login(dto)).rejects.toThrow('Invalid email or password');
    expect(sessions.create).not.toHaveBeenCalled();
  });

  it('returns tokens without exposing a password hash', async () => {
    const user = { _id: 'user-id', supabaseId: 'identity', email: dto.email, passwordHash: await bcrypt.hash(dto.password, 4), isActive: true, emailVerifiedAt: new Date() };
    users.findOne.mockReturnValue({ select: jest.fn().mockResolvedValue(user) });
    sessions.create.mockResolvedValue({ _id: 'session-id' });
    const result = await service.login(dto) as any;
    expect(result.accessToken).toBe('signed-access-token');
    expect(result.refreshToken).toHaveLength(64);
    expect(result.user).not.toHaveProperty('passwordHash');
    expect(sessions.create.mock.calls[0][0].refreshTokenHash).not.toBe(result.refreshToken);
  });

  it('revokes the session when an already-used refresh token is replayed', async () => {
    sessions.findOneAndUpdate.mockResolvedValue(null);
    await expect(service.refreshToken('a'.repeat(64))).rejects.toThrow('Invalid or expired');
    expect(sessions.updateMany).toHaveBeenCalledWith(
      { usedRefreshTokenHashes: expect.any(String), revokedAt: null },
      { $set: { revokedAt: expect.any(Date) } },
    );
  });

  it('revokes all sessions on logout', async () => {
    await service.logout({ _id: 'user-id', supabaseId: 'identity' } as any);
    expect(sessions.updateMany).toHaveBeenCalledWith(
      { userId: 'user-id', revokedAt: null }, { $set: { revokedAt: expect.any(Date) } },
    );
  });

  it('rejects missing refresh tokens', async () => {
    await expect(service.refreshToken(undefined as any)).rejects.toThrow('Invalid or expired');
  });
});
