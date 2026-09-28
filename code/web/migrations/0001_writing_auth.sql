create table "user" ("id" text not null primary key, "name" text not null, "email" text not null unique, "emailVerified" integer not null, "image" text, "createdAt" date not null, "updatedAt" date not null);

create table "session" ("id" text not null primary key, "expiresAt" date not null, "token" text not null unique, "createdAt" date not null, "updatedAt" date not null, "ipAddress" text, "userAgent" text, "userId" text not null references "user" ("id") on delete cascade);

create table "account" ("id" text not null primary key, "accountId" text not null, "providerId" text not null, "userId" text not null references "user" ("id") on delete cascade, "accessToken" text, "refreshToken" text, "idToken" text, "accessTokenExpiresAt" date, "refreshTokenExpiresAt" date, "scope" text, "password" text, "createdAt" date not null, "updatedAt" date not null);

create table "verification" ("id" text not null primary key, "identifier" text not null, "value" text not null, "expiresAt" date not null, "createdAt" date not null, "updatedAt" date not null);

create index "session_userId_idx" on "session" ("userId");

create index "account_userId_idx" on "account" ("userId");

create index "verification_identifier_idx" on "verification" ("identifier");
INSERT INTO "user" ("id","name","email","emailVerified","image","createdAt","updatedAt") VALUES ('HzM2RHtjmLvUQfnrWieaMWRDTXe2tkWv','Writer','writer@quiescent.test',0,NULL,'2026-09-28T02:30:35.848Z','2026-09-28T02:30:35.848Z');
INSERT INTO "account" ("id","accountId","providerId","userId","accessToken","refreshToken","idToken","accessTokenExpiresAt","refreshTokenExpiresAt","scope","password","createdAt","updatedAt") VALUES ('CzzzdizsZPenSiVNuQDIBECtiWOVQklR','HzM2RHtjmLvUQfnrWieaMWRDTXe2tkWv','credential','HzM2RHtjmLvUQfnrWieaMWRDTXe2tkWv',NULL,NULL,NULL,NULL,NULL,NULL,'398256395442fae140f4a0dfbb81e504:65df75e2c5162911b9eef317b66b41980ac981652ed6283ad3eede69f0d07e7fb9aa613086d1336b3cf3139bca683ff96ac60f30fadb2b8c03df6c212db508cf','2026-09-28T02:30:35.850Z','2026-09-28T02:30:35.850Z');
