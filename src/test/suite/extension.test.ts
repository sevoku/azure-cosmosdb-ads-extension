import * as assert from "assert";
import ConnectionString from "mongodb-connection-string-url";
import { after } from "mocha";

// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
import * as vscode from "vscode";
import { buildMongoConnectionString, parseMongoConnectionString } from "../../Providers/connectionString";
import { convertToConnectionOptions } from "../../models";
// import * as myExtension from '../../extension';

suite("Extension Test Suite", () => {
  vscode.window.showInformationMessage("Start all tests.");

  test("Sample test", () => {
    assert.equal(-1, [1, 2, 3].indexOf(5));
    assert.equal(-1, [1, 2, 3].indexOf(0));
  });
});

suite("Connection String Test Suite", () => {
  const csTestInfos: {
    cs: string;
    server: string;
    user: string;
    password: string;
    authenticationType: string;
    pathname: string;
    search: string;
    isServer: boolean;
  }[] = [
    {
      cs: "mongodb://test-mongo:password@test-mongo.mongo.cosmos.azure.com:10255/?ssl=true&replicaSet=globaldb&retrywrites=false&maxIdleTimeMS=987&appName=@test-mongo@",
      server: "test-mongo.mongo.cosmos.azure.com:10255",
      user: "test-mongo",
      password: "password",
      authenticationType: "SqlLogin",
      pathname: "/",
      search: "?ssl=true&replicaSet=globaldb&retrywrites=false&maxIdleTimeMS=987&appName=@test-mongo@",
      isServer: false,
    },
    {
      cs: "mongodb://localhost",
      server: "localhost",
      user: "",
      password: "",
      authenticationType: "Integrated",
      pathname: "/",
      search: "",
      isServer: false,
    },
    {
      cs: "mongodb://sysop:moon@localhost",
      server: "localhost",
      user: "sysop",
      password: "moon",
      authenticationType: "SqlLogin",
      pathname: "/",
      search: "",
      isServer: false,
    },
    {
      cs: "mongodb://sysop:moon@localhost/records",
      server: "localhost",
      user: "sysop",
      password: "moon",
      authenticationType: "SqlLogin",
      pathname: "/records",
      search: "",
      isServer: false,
    },
    {
      cs: "mongodb://%2Ftmp%2Fmongodb-27017.sock",
      server: "%2Ftmp%2Fmongodb-27017.sock",
      user: "",
      password: "",
      authenticationType: "Integrated",
      pathname: "/",
      search: "",
      isServer: false,
    },
    {
      cs: "mongodb://db1.example.net,db2.example.com/?replicaSet=test",
      server: "db1.example.net,db2.example.com",
      user: "",
      password: "",
      authenticationType: "Integrated",
      pathname: "/",
      search: "?replicaSet=test",
      isServer: false,
    },
    {
      cs: "mongodb://router1.example.com:27017,router2.example2.com:27017,router3.example3.com:27017/",
      server: "router1.example.com:27017,router2.example2.com:27017,router3.example3.com:27017",
      user: "",
      password: "",
      authenticationType: "Integrated",
      pathname: "/",
      search: "",
      isServer: false,
    },
    {
      cs: "mongodb+srv://keyid:secretkey@cluster0.example.com/testdb?authSource=$external&authMechanism=MONGODB-AWS",
      server: "cluster0.example.com",
      user: "keyid",
      password: "secretkey",
      authenticationType: "SqlLogin",
      pathname: "/testdb",
      search: "?authSource=$external&authMechanism=MONGODB-AWS",
      isServer: true,
    },
  ];

  test("Parse and build connection string yields same string", () => {
    csTestInfos.forEach((csTestInfo) => {
      const parsedUrl = parseMongoConnectionString(csTestInfo.cs);

      if (!parsedUrl) {
        assert.fail(`Failed to parse ${csTestInfo.cs}`);
      }

      const options = convertToConnectionOptions(parsedUrl);
      const reconstructedUrl = buildMongoConnectionString(options);

      if (!reconstructedUrl) {
        assert.fail(`Failed to build mongo connection string: ${JSON.stringify(parsedUrl)}`);
      }

      assert(areUrlEquivalent(reconstructedUrl, csTestInfo.cs));
    });
  });

  test("Parse connection string extracts information", () => {
    csTestInfos.forEach((csTestInfo) => {
      const parsedUrl = parseMongoConnectionString(csTestInfo.cs);

      ["server", "user", "password", "authenticationType", "pathname", "search", "isServer"].forEach((field) =>
        assert.strictEqual(parsedUrl?.options[field], (csTestInfo as any)[field])
      );
    });
  });

  test("Build connection string doesn't work for AzureMFA", () => {
    const options = {
      authenticationType: "AzureMFA",
      user: "user",
      password: "password",
    };
    assert.strictEqual(buildMongoConnectionString(options as any), undefined);
  });

  test("Build connection string with username/password", () => {
    const options = {
      authenticationType: "SqlLogin",
      user: "username",
      password: "password",
      server: "server",
      pathname: "/pathname",
      search: "?search=blah",
      isServer: false,
    };
    assert.strictEqual(buildMongoConnectionString(options), "mongodb://username:password@server/pathname?search=blah");
  });

  test("Build connection string no username/password", () => {
    const options = {
      authenticationType: "Integrated",
      user: "username",
      password: "password",
      server: "server",
      pathname: "/pathname",
      search: "?search=blah",
      isServer: false,
    };
    assert.strictEqual(buildMongoConnectionString(options), "mongodb://server/pathname?search=blah");
  });

  test("Build connection string mongodb+srv", () => {
    const options = {
      authenticationType: "Integrated",
      user: "username",
      password: "password",
      server: "server",
      pathname: "/pathname",
      search: "?search=blah",
      isServer: true,
    };
    assert.strictEqual(buildMongoConnectionString(options), "mongodb+srv://server/pathname?search=blah");
  });

  test("Build connection string no pathname no search params", () => {
    const options = {
      authenticationType: "Integrated",
      user: "username",
      password: "password",
      server: "server",
      pathname: "",
      search: "",
      isServer: true,
    };
    assert.strictEqual(buildMongoConnectionString(options), "mongodb+srv://server");
  });

  test("Build connection string cosmosdb account", () => {
    const options = {
      authenticationType: "SqlLogin",
      user: "username",
      password: "password",
      server: "server.cosmos.azure.com",
      pathname: "",
      search: "",
      isServer: false,
    };
    const cs = buildMongoConnectionString(options);
    assert.strictEqual(cs !== undefined, true);
    assert.match(cs!, /ssl=true/);
    assert.match(cs!, /replicaSet=globaldb/);
    assert.match(cs!, /retrywrites=false/);
    assert.match(cs!, /maxIdleTimeMS=120000/);
    assert.match(cs!, /appName=%40username%40/);
  });

  test("Build connection string cosmosdb account with port number", () => {
    const options = {
      authenticationType: "SqlLogin",
      user: "username",
      password: "password",
      server: "server.cosmos.azure.com:1234",
      pathname: "",
      search: "",
      isServer: false,
    };
    const cs = buildMongoConnectionString(options);
    assert.strictEqual(cs !== undefined, true);
    assert.match(cs!, /ssl=true/);
    assert.match(cs!, /replicaSet=globaldb/);
    assert.match(cs!, /retrywrites=false/);
    assert.match(cs!, /maxIdleTimeMS=120000/);
    assert.match(cs!, /appName=%40username%40/);
  });

  test("Build connection string cosmosdb account: do not overwrite maxIdleTimeMS", () => {
    const options = {
      authenticationType: "SqlLogin",
      user: "username",
      password: "password",
      server: "server.cosmos.azure.com:1234",
      pathname: "",
      search: "maxIdleTimeMS=123",
      isServer: false,
    };
    const cs = buildMongoConnectionString(options);
    assert.match(cs!, /maxIdleTimeMS=123/);
  });
});

const areUrlEquivalent = (urlString1: string, urlString2: string): boolean => {
  const url1 = new ConnectionString(urlString1);
  const url2 = new ConnectionString(urlString2);

  for (const [key1, value1] of url1.searchParams) {
    if (!url2.searchParams.has(key1) || url2.searchParams.get(key1) !== value1) {
      return false;
    }
  }

  for (const [key2, value2] of url2.searchParams) {
    if (!url1.searchParams.has(key2) || url1.searchParams.get(key2) !== value2) {
      return false;
    }
  }

  return true;
};
