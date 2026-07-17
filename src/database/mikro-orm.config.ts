import { defineConfig } from "@mikro-orm/sqlite";
import { DocMeta } from "./entities/doc-meta.js";
import { Mention } from "./entities/mention.js";
import { OAuthToken } from "./entities/oauth-token.js";
import { Pageview } from "./entities/pageview.js";
import { Syndication } from "./entities/syndication.js";
import { Term } from "./entities/term.js";
import { TermRelationship } from "./entities/term-relationship.js";

export default defineConfig({
  entities: [
    DocMeta,
    Term,
    TermRelationship,
    Syndication,
    OAuthToken,
    Mention,
    Pageview,
  ],
  dbName: process.env.HYPERNEXT_DB_PATH ?? "./hypernext.db",
  debug: false,
  allowGlobalContext: true,
});
