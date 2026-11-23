import { ConfigModule } from '@nestjs/config';
import type { SuperTokensModuleOptions } from 'supertokens-nestjs';
import EmailPassword from 'supertokens-node/recipe/emailpassword';
import Session from 'supertokens-node/recipe/session';

export const appInfo = {
  appName: process.env.SUPERTOKENS_APP_NAME ?? 'Library Book Retrieval',
  apiDomain: process.env.SUPERTOKENS_API_DOMAIN ?? 'http://localhost:3000',
  websiteDomain:
    process.env.SUPERTOKENS_WEBSITE_DOMAIN ?? 'http://localhost:5173',
  apiBasePath: process.env.SUPERTOKENS_API_BASE_PATH ?? '/auth',
  websiteBasePath: process.env.SUPERTOKENS_WEBSITE_BASE_PATH ?? '/auth',
};

export const supertokensConfig: SuperTokensModuleOptions = {
  framework: 'express',
  supertokens: {
    connectionURI:
      process.env.SUPERTOKENS_CONNECTION_URI ?? 'http://localhost:3567',
    ...(process.env.SUPERTOKENS_API_KEY
      ? { apiKey: process.env.SUPERTOKENS_API_KEY }
      : {}),
  },
  appInfo,
  recipeList: [EmailPassword.init(), Session.init()],
};
