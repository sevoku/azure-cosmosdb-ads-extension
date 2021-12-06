/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the Source EULA. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as azdata from "azdata";
import { ICellActionEventArgs } from "azdata";
import * as vscode from "vscode";
import * as nls from "vscode-nls";
import {
  AppContext,
  isAzureconnection,
  retrieveDatabaseAccountInfoFromArm,
  retrieveMongoDbDatabasesInfoFromArm,
} from "../appContext";
import { buildHeroCard } from "./util";

const localize = nls.loadMessageBundle();

const buildToolbar = (view: azdata.ModelView, context: vscode.ExtensionContext): azdata.ToolbarContainer => {
  const buttons: (azdata.ButtonProperties & { onDidClick: () => void })[] = [
    {
      label: localize("newDatabase", "New Database"),
      iconPath: {
        light: context.asAbsolutePath("images/AddDatabase.svg"),
        dark: context.asAbsolutePath("images/AddDatabase.svg"),
      },
      onDidClick: () =>
        vscode.commands.executeCommand("cosmosdb-ads-extension.createMongoDatabase", {
          connectionProfile: view.connection,
        }),
    },
    {
      label: localize("openMongoShell", "Open Mongo Shell"),
      iconPath: {
        light: context.asAbsolutePath("images/Hosted-Terminal.svg"),
        dark: context.asAbsolutePath("images/Hosted-Terminal.svg"),
      },
      onDidClick() {
        vscode.commands.executeCommand("cosmosdb-ads-extension.openMongoShell", {
          connectionProfile: view.connection,
        });
      },
    },
    /* TODO Implement
    {
      label: localize("refresh", "Refresh"),
      iconPath: {
        light: context.asAbsolutePath("images/refresh-cosmos.svg"),
        dark: context.asAbsolutePath("images/refresh-cosmos.svg"),
      },
      onDidClick() {
        console.log("Not implemented");
      },
    },
		*/
    {
      label: localize("learnMore", "Learn more"),
      iconPath: {
        light: context.asAbsolutePath("images/Info.svg"),
        dark: context.asAbsolutePath("images/Info.svg"),
      },
      onDidClick() {
        console.log("Not implemented");
      },
    },
  ];
  const navElements: azdata.ButtonComponent[] = buttons.map((b) => {
    const component = view.modelBuilder.button().withProperties(b).component();
    component.onDidClick(b.onDidClick);
    return component;
  });
  return view.modelBuilder
    .toolbarContainer()
    .withItems(navElements)
    .withLayout({ orientation: azdata.Orientation.Horizontal })
    .component();
};

const buildOverview = async (view: azdata.ModelView): Promise<azdata.Component> => {
  const databaseAccountInfo = await retrieveDatabaseAccountInfoFromArm(view.connection);
  const propertyItems: azdata.PropertiesContainerItem[] = [
    {
      displayName: localize("status", "Status"),
      value: databaseAccountInfo.serverStatus,
    },
    {
      displayName: localize("consistencyPolicy", "Consistency policy"),
      value: databaseAccountInfo.consistencyPolicy,
    },
    {
      displayName: localize("backupPolicy", "Backup policy"),
      value: databaseAccountInfo.backupPolicy,
    },
    {
      displayName: localize("readLocation", "Read location"),
      value: databaseAccountInfo.readLocations.join(","),
    },
  ];

  const properties = view.modelBuilder.propertiesContainer().withProperties({ propertyItems }).component();
  return view.modelBuilder
    .divContainer()
    .withItems([properties])
    .withProperties({
      CSSStyles: {
        padding: "10px",
        "border-bottom": "1px solid rgba(128, 128, 128, 0.35)",
      },
    })
    .component();
};

const buildGettingStarted = (view: azdata.ModelView, context: vscode.ExtensionContext): azdata.Component => {
  const heroCards: azdata.ButtonComponent[] = [
    buildHeroCard(
      view,
      context.asAbsolutePath("images/AddDatabase.svg"),
      localize("newDatabase", "New Database"),
      localize("newDtabaseDescription", "Create database to store you data"),
      () =>
        vscode.commands.executeCommand("cosmosdb-ads-extension.createMongoDatabase", {
          connectionProfile: view.connection,
        })
    ),
    buildHeroCard(
      view,
      context.asAbsolutePath("images/Hosted-Terminal.svg"),
      localize("openMongoShell", "Open Mongo Shell"),
      localize("mongoShellDescription", "Interact with data using Mongo shell"),
      () =>
        vscode.commands.executeCommand("cosmosdb-ads-extension.openMongoShell", {
          connectionProfile: view.connection,
        })
    ),
    buildHeroCard(
      view,
      context.asAbsolutePath("images/azure.svg"),
      localize("openInPortal", "Open in portal"),
      localize("openInPortalDescription", "View and manage this account (e.g. backup settings) in Azure portal"),
      () => openInPortal(view.connection)
    ),
    buildHeroCard(
      view,
      context.asAbsolutePath("images/Info.svg"),
      localize("documentation", "Documentation"),
      localize("documentation", "Find quickstarts, how-to guides, and references."),
      () => {
        /* TODO NOT IMPLEMENTED */
      }
    ),
  ];

  const heroCardsContainer = view.modelBuilder
    .flexContainer()
    .withItems(heroCards)
    .withLayout({ flexFlow: "row", flexWrap: "wrap" })
    .withProperties({ CSSStyles: { width: "100%" } })
    .component();

  return view.modelBuilder
    .flexContainer()
    .withItems([
      view.modelBuilder
        .text()
        .withProperties({
          value: localize("gettingStarted", "Getting started"),
          CSSStyles: { "font-size": "20px", "font-weight": "600" },
        })
        .component(),
      view.modelBuilder
        .text()
        .withProperties({
          value: localize(
            "gettingStartedDescription",
            "Getting started with creating a new database, using mongo shell, viewing documentation, and managing via portal"
          ),
        })
        .component(),
      heroCardsContainer,
    ])
    .withLayout({ flexFlow: "column" })
    .withProperties({
      CSSStyles: {
        padding: "10px",
      },
    })
    .component();
};

const buildTabArea = (view: azdata.ModelView, context: vscode.ExtensionContext): azdata.Component => {
  const input2 = view.modelBuilder
    .inputBox()
    .withProperties<azdata.InputBoxProperties>({ value: "input 2" })
    .component();

  const tabs: azdata.Tab[] = [
    {
      id: "tab1",
      content: buildGettingStarted(view, context),
      title: localize("gettingStarted", "Getting started"),
    },
    {
      id: "tab2",
      content: input2,
      title: localize("monitoring", "Monitoring"),
    },
  ];
  return view.modelBuilder
    .tabbedPanel()
    .withTabs(tabs)
    .withLayout({ orientation: azdata.TabOrientation.Horizontal })
    .withProps({
      CSSStyles: {
        height: "200px",
      },
    })
    .component();
};

const buildDatabasesAreaAzure = async (
  view: azdata.ModelView,
  context: vscode.ExtensionContext
): Promise<azdata.Component> => {
  const databasesInfo = await retrieveMongoDbDatabasesInfoFromArm(view.connection);

  const tableComponent = view.modelBuilder
    .table()
    .withProperties<azdata.TableComponentProperties>({
      columns: [
        <azdata.HyperlinkColumn>{
          value: localize("database", "Database"),
          type: azdata.ColumnType.hyperlink,
          name: "Database",
          width: 250,
        },
        {
          value: localize("dataUsage", "Data Usage (KB)"),
          type: azdata.ColumnType.text,
        },
        {
          value: localize("collection", "Collections"),
          type: azdata.ColumnType.text,
        },
        {
          value: localize("throughputSharedAccrossCollection", "Throughput Shared Across Collections"),
          type: azdata.ColumnType.text,
        },
      ],
      data: databasesInfo.map((db) => [
        <azdata.HyperlinkColumnCellValue>{
          title: db.name,
          icon: {
            light: context.asAbsolutePath("resources/light/database.svg"),
            dark: context.asAbsolutePath("resources/dark/database-inverse.svg"),
          },
        },
        db.usageSizeKB === undefined ? localize("unknown", "Unknown") : db.usageSizeKB,
        db.nbCollections,
        db.throughputSetting,
      ]),
      height: 500,
      CSSStyles: {
        padding: "20px",
      },
    })
    .component();

  if (tableComponent.onCellAction) {
    tableComponent.onCellAction((arg: ICellActionEventArgs) => {
      const azureAccountId = view.connection.options["azureAccount"];
      vscode.commands.executeCommand(
        "cosmosdb-ads-extension.openDatabaseDashboard",
        azureAccountId,
        databasesInfo[arg.row].name,
        context
      );
    });
  }

  return view.modelBuilder
    .flexContainer()
    .withItems([
      view.modelBuilder
        .text()
        .withProperties({
          value: localize("databaseOverview", "Database overview"),
          CSSStyles: { "font-size": "20px", "font-weight": "600" },
        })
        .component(),
      view.modelBuilder
        .text()
        .withProperties({
          value: localize("databaseOverviewDescription", "Click on a database for more details"),
        })
        .component(),
      tableComponent,
    ])
    .withLayout({ flexFlow: "column" })
    .withProperties({ CSSStyles: { padding: "10px" } })
    .component();
};

const buildDatabasesAreaNonAzure = async (
  view: azdata.ModelView,
  context: vscode.ExtensionContext,
  appContext: AppContext
): Promise<azdata.Component> => {
  const databasesInfo: { name: string; nbCollections: number; sizeOnDisk: number }[] = [];
  const server = view.connection.options["server"];
  for (const db of await appContext.listDatabases(server)) {
    const name = db.name;
    if (name !== undefined) {
      const colls = await appContext.listCollections(server, name);
      console.log(colls);
      const nbCollections = (await appContext.listCollections(server, name)).length;
      databasesInfo.push({ name, nbCollections, sizeOnDisk: db.sizeOnDisk });
    }
  }

  const tableComponent = view.modelBuilder
    .table()
    .withProperties<azdata.TableComponentProperties>({
      columns: [
        {
          value: localize("database", "Database"),
          type: azdata.ColumnType.text,
          width: 250,
        },
        {
          value: localize("sizeOnDisk", "Size On Disk"),
          type: azdata.ColumnType.text,
        },
        {
          value: localize("collections", "Collections"),
          type: azdata.ColumnType.text,
        },
      ],
      data: databasesInfo.map((db) => [db.name, db.sizeOnDisk, db.nbCollections]),
      height: 500,
      CSSStyles: {
        padding: "20px",
      },
    })
    .component();

  if (tableComponent.onCellAction) {
    tableComponent.onCellAction((arg: ICellActionEventArgs) => {
      const azureAccountId = view.connection.options["azureAccount"];
      vscode.commands.executeCommand(
        "cosmosdb-ads-extension.openDatabaseDashboard",
        azureAccountId,
        databasesInfo[arg.row].name,
        context
      );
    });
  }

  return view.modelBuilder
    .flexContainer()
    .withItems([
      view.modelBuilder
        .text()
        .withProperties({
          value: localize("databaseOverview", "Database overview"),
          CSSStyles: { "font-size": "20px", "font-weight": "600" },
        })
        .component(),
      view.modelBuilder
        .text()
        .withProperties({
          value: localize("clickOnDatabaseDescription", "Click on a database for more details"),
        })
        .component(),
      tableComponent,
    ])
    .withLayout({ flexFlow: "column" })
    .withProperties({ CSSStyles: { padding: "10px" } })
    .component();
};

export const registerHomeDashboardTabs = (context: vscode.ExtensionContext, appContext: AppContext): void => {
  azdata.ui.registerModelViewProvider("mongo-account-home", async (view) => {
    const viewItems: azdata.Component[] = [buildToolbar(view, context)];
    if (isAzureconnection(view.connection)) {
      viewItems.push(await buildOverview(view));
    }
    viewItems.push(buildGettingStarted(view, context));

    const homeTabContainer = view.modelBuilder
      .flexContainer()
      // .withItems([buildToolbar(view, context), await buildOverview(view), buildTabArea(view, context)]) // Use this for monitoring tab
      .withItems(viewItems)
      .withLayout({ flexFlow: "column" })
      .component();
    await view.initializeModel(homeTabContainer);
  });

  azdata.ui.registerModelViewProvider("mongo-databases.tab", async (view) => {
    const viewItem = isAzureconnection(view.connection)
      ? await buildDatabasesAreaAzure(view, context)
      : await buildDatabasesAreaNonAzure(view, context, appContext);

    const homeTabContainer = view.modelBuilder
      .flexContainer()
      .withItems([viewItem])
      .withLayout({ flexFlow: "column" })
      .component();
    await view.initializeModel(homeTabContainer);
  });
};

const openInPortal = (connection: azdata.connection.Connection) => {
  const azurePortalEndpoint = connection?.options?.azurePortalEndpoint;
  const azureResourceId = connection?.options?.azureResourceId;
  if (!azurePortalEndpoint || !azureResourceId) {
    vscode.window.showErrorMessage(localize("missingAzureInformation", "Missing azure information from connection"));
    return;
  }
  const url = `${azurePortalEndpoint}/#@microsoft.onmicrosoft.com/resource${azureResourceId}/overview`;
  vscode.env.openExternal(vscode.Uri.parse(url));
};
