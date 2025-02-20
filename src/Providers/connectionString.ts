import ConnectionString from "mongodb-connection-string-url";
import * as azdata from "azdata";

/**
 * Specs are here:
 * Examples from here: https://www.mongodb.com/docs/manual/reference/connection-string/#std-label-connections-connection-examples
 * mongodb://languye-mongo:password@languye-mongo.mongo.cosmos.azure.com:10255/?ssl=true&replicaSet=globaldb&retrywrites=false&maxIdleTimeMS=120000&appName=@languye-mongo@
 * mongodb://localhost
 * mongodb://sysop:moon@localhost
 * mongodb://sysop:moon@localhost/records
 * mongodb://%2Ftmp%2Fmongodb-27017.sock : socket filepath
 * mongodb://db1.example.net,db2.example.com/?replicaSet=test : replica. Take first host
 * mongodb://router1.example.com:27017,router2.example2.com:27017,router3.example3.com:27017/ : multiple mongo instances
 * mongodb+srv://<aws access key id>:<aws secret access key>@cluster0.example.com/testdb?authSource=$external&authMechanism=MONGODB-AWS : mongo atlas
 *
 * @param connectionString
 * @returns
 */
export const parseMongoConnectionString = (connectionString: string): azdata.ConnectionInfo | undefined => {
  const url = new ConnectionString(connectionString);
  const hosts = url.hosts;

  if (!hosts || hosts.length < 1) {
    return undefined;
  }

  const username = url.username;
  let authenticationType = "SqlLogin";
  if (!username) {
    authenticationType = "Integrated";
  }

  return {
    options: {
      server: hosts.join(","),
      user: username,
      password: url.password,
      authenticationType,
      pathname: url.pathname,
      search: url.search,
      isServer: url.isSRV,
    },
  };
};

export const buildMongoConnectionString = (options: {
  authenticationType: string;
  server: string;
  isServer: boolean;
  user: string;
  password: string;
  pathname: string;
  search: string;
}): string | undefined => {
  if (options.authenticationType === "AzureMFA") {
    // No connection string with Azure MFA
    return undefined;
  }

  const url = new ConnectionString(`mongodb${options.isServer ? "+srv" : ""}://placeholder`);
  url.hosts = options["server"].split(",");

  if (options.authenticationType === "SqlLogin") {
    url.username = options["user"];
    url.password = options["password"];
  }

  url.pathname = options["pathname"] || "";
  url.search = options["search"] || "";

  // CosmosDB account need these parameters (hostname ends with cosmos.azure.com)
  if (options.server.match(/\.cosmos\.azure\.com(:[0-9]*)*$/g)) {
    url.searchParams.set("ssl", "true");
    url.searchParams.set("replicaSet", "globaldb");
    url.searchParams.set("retrywrites", "false");
    url.searchParams.set("maxIdleTimeMS", url.searchParams.get("maxIdleTimeMS") || "120000");
    url.searchParams.set("appName", `@${options.user}@`);
  }
  return url.toString();
};
