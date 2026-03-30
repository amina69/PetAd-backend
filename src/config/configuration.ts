import { config } from 'dotenv';

config();

export default () => ({
  port: parseInt(process.env.PORT || '3000', 10),
  redis: process.env.REDIS_URL || 'redis://localhost:6379',
});
