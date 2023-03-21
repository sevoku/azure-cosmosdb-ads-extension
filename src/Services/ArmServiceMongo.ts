import * as vscode from "vscode";
import * as nls from "vscode-nls";
import * as azdata from "azdata";
import { CosmosDBManagementClient } from "@azure/arm-cosmosdb";
import { MonitorManagementClient } from "@azure/arm-monitor";
import { TokenCredentials } from "@azure/ms-rest-js";
import {
  MongoDBCollectionCreateUpdateParameters,
  MongoDBDatabaseCreateUpdateParameters,
} from "@azure/arm-cosmosdb/esm/models";
import { getUsageSizeInKB } from "../Dashboards/getCollectionDataUsageSize";
import { ICosmosDbCollectionInfo, ICosmosDbDatabaseInfo } from "../models";
import {
  createNewCollectionDialog,
  createNewDatabaseDialog,
  NewCollectionFormData,
  NewDatabaseFormData,
} from "../dialogUtil";
import { CdbCollectionCreateInfo } from "../sampleData/DataSamplesUtil";
import { hideStatusBarItem, showStatusBarItem } from "../appContext";
import { AbstractArmService } from "./AbstractArmService";

const localize = nls.loadMessageBundle();

export class ArmServiceMongo extends AbstractArmService {
  /**
   *
   * @param client
   * @param resourceGroupName
   * @param accountName
   * @param databaseName
   * @param monitorARmClient
   * @param resourceUri
   * @param fetchThroughputOnly meant as an optimization
   * @returns
   */
  private retrieveMongoDbDatabaseInfoFromArm = async (
    client: CosmosDBManagementClient,
    resourceGroupName: string,
    accountName: string,
    databaseName: string,
    monitorARmClient: MonitorManagementClient,
    resourceUri: string,
    fetchThroughputOnly?: boolean
  ): Promise<ICosmosDbDatabaseInfo> => {
    let throughputSetting = "";
    let isAutoscale: boolean = false;
    let currentThroughput: number | undefined;
    try {
      showStatusBarItem(localize("retrievingMongoDbDatabaseThroughput", "Retrieving mongodb database throughput..."));
      const rpResponse = await client.mongoDBResources.getMongoDBDatabaseThroughput(
        resourceGroupName,
        accountName,
        databaseName
      );

      if (rpResponse.resource) {
        throughputSetting = this.throughputSettingToString(rpResponse.resource);
        isAutoscale = !!rpResponse.resource.autoscaleSettings;
        currentThroughput = rpResponse.resource.throughput;
      }
    } catch (e) {
      // Entity with the specified id does not exist in the system. More info: https://aka.ms/cosmosdb-tsg-not-found
    } finally {
      hideStatusBarItem();
    }
    if (fetchThroughputOnly) {
      return {
        name: databaseName,
        nbCollections: undefined,
        throughputSetting,
        usageSizeKB: undefined,
        isAutoscale,
        currentThroughput,
      };
    }

    showStatusBarItem(localize("retrievingMongoDbCollection", "Retrieving mongodb collections..."));
    const collections = await client.mongoDBResources.listMongoDBCollections(
      resourceGroupName,
      accountName,
      databaseName
    );

    showStatusBarItem(localize("retrievingMongoDbDatabaseThroughput", "Retrieving mongodb database usage..."));
    const usageSizeKB = await getUsageSizeInKB(monitorARmClient, resourceUri, databaseName);

    return {
      name: databaseName,
      nbCollections: collections.length,
      throughputSetting,
      usageSizeKB,
      isAutoscale,
      currentThroughput,
    };
  };

  /**
   *
   * @param azureAccountId
   * @param azureTenantId
   * @param azureResourceId
   * @param cosmosDbAccountName
   * @param fetchThroughputOnly Optimization to not fetch everything
   * @returns
   */
  public retrieveDatabasesInfo = async (
    azureAccountId: string,
    azureTenantId: string,
    azureResourceId: string,
    cosmosDbAccountName: string,
    fetchThroughputOnly?: boolean
  ): Promise<ICosmosDbDatabaseInfo[]> => {
    const client = await this.createArmClient(azureAccountId, azureTenantId, azureResourceId, cosmosDbAccountName);

    azureResourceId = await this.retrieveResourceId(
      azureAccountId,
      azureTenantId,
      azureResourceId,
      cosmosDbAccountName
    );

    const { resourceGroup } = this.parsedAzureResourceId(azureResourceId);

    showStatusBarItem(localize("retrievingMongoDbDatabases", "Retrieving mongodb databases..."));
    const mongoDBResources = await client.mongoDBResources.listMongoDBDatabases(resourceGroup, cosmosDbAccountName);
    hideStatusBarItem();
    const monitorArmClient = await this.createArmMonitorClient(
      azureAccountId,
      azureTenantId,
      azureResourceId,
      cosmosDbAccountName
    );

    // TODO Error handling here for missing databaseName
    const promises = mongoDBResources
      .filter((resource) => !!resource.name)
      .map((resource) =>
        this.retrieveMongoDbDatabaseInfoFromArm(
          client,
          resourceGroup,
          cosmosDbAccountName,
          resource.name!,
          monitorArmClient,
          azureResourceId,
          fetchThroughputOnly
        )
      );

    return await Promise.all(promises);
  };

  private retrieveMongoDbCollectionInfoFromArm = async (
    client: CosmosDBManagementClient,
    resourceGroupName: string,
    accountName: string,
    databaseName: string,
    collectionName: string,
    monitorARmClient: MonitorManagementClient,
    resourceUri: string
  ): Promise<ICosmosDbCollectionInfo> => {
    let throughputSetting = "";
    let isAutoscale: boolean = false;
    let currentThroughput: number | undefined;
    try {
      const rpResponse = await client.mongoDBResources.getMongoDBCollectionThroughput(
        resourceGroupName,
        accountName,
        databaseName,
        collectionName
      );

      if (rpResponse.resource) {
        throughputSetting = this.throughputSettingToString(rpResponse.resource);
        isAutoscale = !!rpResponse.resource.autoscaleSettings;
        currentThroughput = rpResponse.resource.throughput;
      }
    } catch (e) {
      // Entity with the specified id does not exist in the system. More info: https://aka.ms/cosmosdb-tsg-not-found
      // Shared throughput case
    }

    // Retrieve metrics
    const usageDataKB = await getUsageSizeInKB(monitorARmClient, resourceUri, databaseName, collectionName);
    const filter = `DatabaseName eq '${databaseName}' and CollectionName eq '${collectionName}'`;
    const metricnames = "DocumentCount";

    let documentCount;
    try {
      showStatusBarItem(localize("retrievingMongoDbUsage", "Retrieving mongodb usage..."));
      const metricsResponse = await monitorARmClient.metrics.list(resourceUri, { filter, metricnames });
      documentCount = metricsResponse.value[0].timeseries?.[0].data?.[0]?.total;
    } catch (e) {
      console.error(e);
    } finally {
      hideStatusBarItem();
    }

    // Retrieve shard key
    let shardKey;
    try {
      showStatusBarItem(localize("retrievingMongoCollectionInfo", "Retrieving mongodb collection information..."));
      const collInfoResponse = await client.mongoDBResources.getMongoDBCollection(
        resourceGroupName,
        accountName,
        databaseName,
        collectionName
      );
      shardKey = collInfoResponse.resource?.shardKey;
    } catch (e) {
      console.error(e);
      // TODO Rethrow?
    } finally {
      hideStatusBarItem();
    }

    return {
      name: collectionName,
      documentCount,
      throughputSetting,
      usageSizeKB: usageDataKB,
      isAutoscale,
      currentThroughput,
      shardKey,
    };
  };

  public retrieveCollectionsInfo = async (
    azureAccountId: string,
    azureTenantId: string,
    azureResourceId: string,
    cosmosDbAccountName: string,
    databaseName: string
  ): Promise<ICosmosDbCollectionInfo[]> => {
    const client = await this.createArmClient(azureAccountId, azureTenantId, azureResourceId, cosmosDbAccountName);

    if (!azureResourceId) {
      const azureToken = await this.retrieveAzureToken(azureTenantId, azureAccountId);
      const credentials = new TokenCredentials(azureToken.token, azureToken.tokenType /* , 'Bearer' */);

      const azureResource = await this.retrieveResourceInfofromArm(cosmosDbAccountName, credentials);
      if (!azureResource) {
        throw new Error(localize("azureResourceNotFound", "Azure Resource not found"));
      } else {
        azureResourceId = azureResource.id;
      }
    }
    const { resourceGroup } = this.parsedAzureResourceId(azureResourceId);

    showStatusBarItem(localize("retrievingMongoDbUsage", "Retrieving mongodb usage..."));
    const mongoDBResources = await client.mongoDBResources.listMongoDBCollections(
      resourceGroup,
      cosmosDbAccountName,
      databaseName
    );
    hideStatusBarItem();

    const monitorArmClient = await this.createArmMonitorClient(
      azureAccountId,
      azureTenantId,
      azureResourceId,
      cosmosDbAccountName
    );

    // TODO Error handling here for missing databaseName
    const promises = mongoDBResources
      .filter((resource) => !!resource.name)
      .map((resource) =>
        this.retrieveMongoDbCollectionInfoFromArm(
          client,
          resourceGroup,
          cosmosDbAccountName,
          databaseName,
          resource.name!,
          monitorArmClient,
          azureResourceId
        )
      );

    return await Promise.all(promises);
  };

  public changeCollectionThroughput = async (
    azureAccountId: string,
    azureTenantId: string,
    azureResourceId: string,
    cosmosDbAccountName: string,
    databaseName: string,
    collectionInfo: ICosmosDbCollectionInfo
  ): Promise<boolean> => {
    const mode = await vscode.window.showQuickPick<any>(
      [
        {
          label: "Autoscale",
          onSelect: async (): Promise<boolean> => {
            if (collectionInfo.isAutoscale) {
              vscode.window.showInformationMessage(localize("alreadySetToAutoscale", "Already set to Autoscale"));
              return false;
            } else {
              return await this.migrateMongoDbCollectionToAutoscale(
                azureAccountId,
                azureTenantId,
                azureResourceId,
                cosmosDbAccountName,
                databaseName,
                collectionInfo.name
              );
            }
          },
        },
        {
          label: localize("setThroughput", "Set throughput"),
          onSelect: async (): Promise<boolean> => {
            const requestedThroughputStr = await vscode.window.showInputBox({
              placeHolder: localize("enterThroughput", "Enter throughput (RU)"),
            });

            if (!requestedThroughputStr === undefined) {
              return false;
            }

            const requestedThroughput = Number.parseInt(requestedThroughputStr!);

            if (collectionInfo.currentThroughput === requestedThroughput) {
              vscode.window.showInformationMessage(
                localize("throughputAlreadySetAt", "Throughput already set at {0} RU", requestedThroughput)
              );
              return false;
            } else {
              return await this.updateMongoDbCollectionThroughput(
                azureAccountId,
                azureTenantId,
                azureResourceId,
                cosmosDbAccountName,
                databaseName,
                collectionInfo.name,
                requestedThroughput,
                collectionInfo.isAutoscale
              );
            }
          },
        },
      ],
      {
        placeHolder: localize("useAutoscaleOrSetThroughput", "Use Autoscale or set Throughput manually?"),
      }
    );

    if (!mode) {
      return false;
    }

    return await mode.onSelect();
  };

  private migrateMongoDbCollectionToAutoscale = async (
    azureAccountId: string,
    azureTenantId: string,
    azureResourceId: string,
    cosmosDbAccountName: string,
    databaseName: string,
    collectionName: string
  ): Promise<boolean> => {
    const response = await vscode.window.showInformationMessage(
      localize(
        "migrateCollectionToAutoscaleConfirm",
        "Are you sure you want to migrate the collection {0} to Autoscale?",
        collectionName
      ),
      ...[localize("yes", "Yes"), localize("no", "No")]
    );
    if (response !== "Yes") {
      return false;
    }

    const client = await this.createArmClient(azureAccountId, azureTenantId, azureResourceId, cosmosDbAccountName);
    azureResourceId = await this.retrieveResourceId(
      azureAccountId,
      azureTenantId,
      azureResourceId,
      cosmosDbAccountName
    );
    // TODO: check resourceGroup here
    const { resourceGroup } = this.parsedAzureResourceId(azureResourceId);
    try {
      showStatusBarItem(localize("migratingCollectionToAutoscale", "Migrating collection to autoscale..."));
      const rpResponse = await client.mongoDBResources.migrateMongoDBCollectionToAutoscale(
        resourceGroup,
        cosmosDbAccountName,
        databaseName,
        collectionName
      );

      return !!rpResponse;
    } catch (e) {
      Promise.reject(e);
      return false;
    } finally {
      hideStatusBarItem();
    }
  };

  private updateMongoDbCollectionThroughput = async (
    azureAccountId: string,
    azureTenantId: string,
    azureResourceId: string,
    cosmosDbAccountName: string,
    databaseName: string,
    collectionName: string,
    requestedThroughput: number,
    migrateToManualThroughput: boolean
  ): Promise<boolean> => {
    const response = await vscode.window.showInformationMessage(
      localize(
        "setManualThroughputCollectionConfirm",
        "Are you sure you want to set the collection {0} throughput to {1} RUs?",
        collectionName,
        requestedThroughput
      ),
      ...[localize("yes", "Yes"), localize("no", "No")]
    );
    if (response !== "Yes") {
      return false;
    }

    const client = await this.createArmClient(azureAccountId, azureTenantId, azureResourceId, cosmosDbAccountName);
    azureResourceId = await this.retrieveResourceId(
      azureAccountId,
      azureTenantId,
      azureResourceId,
      cosmosDbAccountName
    );
    // TODO: check resourceGroup here
    const { resourceGroup } = this.parsedAzureResourceId(azureResourceId);

    try {
      let rpResponse;
      if (migrateToManualThroughput) {
        const response = await vscode.window.showInformationMessage(
          localize(
            "migrateToManualThroughputCollectionConfirm",
            "Are you sure you want to migrate the collection {0} to manual throughput?",
            collectionName
          ),
          ...[localize("yes", "Yes"), localize("no", "No")]
        );
        if (response !== "Yes") {
          return false;
        }

        showStatusBarItem(
          localize("migratingCollectionToManualThroughput", "Migrating collection to manual throughput...")
        );
        rpResponse = await client.mongoDBResources.migrateMongoDBCollectionToManualThroughput(
          resourceGroup,
          cosmosDbAccountName,
          databaseName,
          collectionName,
          {
            resource: {
              throughput: requestedThroughput,
            },
          }
        );
      }

      showStatusBarItem(
        localize("updatingCollectionThroughput", "Updating collection throughput to {0} RUs...", requestedThroughput)
      );
      rpResponse = await client.mongoDBResources.updateMongoDBCollectionThroughput(
        resourceGroup,
        cosmosDbAccountName,
        databaseName,
        collectionName,
        {
          resource: {
            throughput: requestedThroughput,
          },
        }
      );

      return !!rpResponse;
    } catch (e) {
      return Promise.reject(e);
    } finally {
      hideStatusBarItem();
    }
  };

  public changeDatabaseThroughput = async (
    azureAccountId: string,
    azureTenantId: string,
    azureResourceId: string,
    cosmosDbAccountName: string,
    databaseInfo: ICosmosDbDatabaseInfo
  ): Promise<boolean> => {
    const mode = await vscode.window.showQuickPick<any>(
      [
        {
          label: "Autoscale",
          onSelect: async (): Promise<boolean> => {
            if (databaseInfo.isAutoscale) {
              vscode.window.showInformationMessage(localize("alreadySetToAutoscale", "Already set to Autoscale"));
              return false;
            } else {
              return await this.migrateMongoDbDatabaseToAutoscale(
                azureAccountId,
                azureTenantId,
                azureResourceId,
                cosmosDbAccountName,
                databaseInfo.name
              );
            }
          },
        },
        {
          label: localize("setThroughput", "Set throughput"),
          onSelect: async (): Promise<boolean> => {
            const requestedThroughputStr = await vscode.window.showInputBox({
              placeHolder: localize("enterThroughput", "Enter throughput (RU)"),
            });

            if (!requestedThroughputStr === undefined) {
              return false;
            }

            const requestedThroughput = Number.parseInt(requestedThroughputStr!);

            if (databaseInfo.currentThroughput === requestedThroughput) {
              vscode.window.showInformationMessage(
                localize("throughputAlreadySetAt", "Throughput already set at {0} RU", requestedThroughput)
              );
              return false;
            } else {
              return await this.updateMongoDbDatabaseThroughput(
                azureAccountId,
                azureTenantId,
                azureResourceId,
                cosmosDbAccountName,
                databaseInfo.name,
                requestedThroughput,
                databaseInfo.isAutoscale
              );
            }
          },
        },
      ],
      {
        placeHolder: localize("useAutoscaleOrSetThroughput", "Use Autoscale or set Throughput manually?"),
      }
    );

    if (!mode) {
      return false;
    }

    return await mode.onSelect();
  };

  private migrateMongoDbDatabaseToAutoscale = async (
    azureAccountId: string,
    azureTenantId: string,
    azureResourceId: string,
    cosmosDbAccountName: string,
    databaseName: string
  ): Promise<boolean> => {
    const response = await vscode.window.showInformationMessage(
      localize(
        "migrateDatabaseToAutoscaleConfirm",
        "Are you sure you want to migrate the database {0} to Autoscale?",
        databaseName
      ),
      ...[localize("yes", "Yes"), localize("no", "No")]
    );
    if (response !== "Yes") {
      return false;
    }

    const client = await this.createArmClient(azureAccountId, azureTenantId, azureResourceId, cosmosDbAccountName);
    azureResourceId = await this.retrieveResourceId(
      azureAccountId,
      azureTenantId,
      azureResourceId,
      cosmosDbAccountName
    );
    // TODO: check resourceGroup here
    const { resourceGroup } = this.parsedAzureResourceId(azureResourceId);
    try {
      showStatusBarItem(localize("migratingDatabaseToAutoscale", "Migrating database to autoscale..."));
      const rpResponse = await client.mongoDBResources.migrateMongoDBDatabaseToAutoscale(
        resourceGroup,
        cosmosDbAccountName,
        databaseName
      );

      return !!rpResponse;
    } catch (e) {
      Promise.reject(e);
      return false;
    } finally {
      hideStatusBarItem();
    }
  };

  private updateMongoDbDatabaseThroughput = async (
    azureAccountId: string,
    azureTenantId: string,
    azureResourceId: string,
    cosmosDbAccountName: string,
    databaseName: string,
    requestedThroughput: number,
    migrateToManualThroughput: boolean
  ): Promise<boolean> => {
    const response = await vscode.window.showInformationMessage(
      localize(
        "setManualThroughputDatabaseConfirm",
        "Are you sure you want to set the database {0} throughput to {1} RUs?",
        databaseName,
        requestedThroughput
      ),
      ...[localize("yes", "Yes"), localize("no", "No")]
    );
    if (response !== "Yes") {
      return false;
    }

    const client = await this.createArmClient(azureAccountId, azureTenantId, azureResourceId, cosmosDbAccountName);
    azureResourceId = await this.retrieveResourceId(
      azureAccountId,
      azureTenantId,
      azureResourceId,
      cosmosDbAccountName
    );
    // TODO: check resourceGroup here
    const { resourceGroup } = this.parsedAzureResourceId(azureResourceId);

    try {
      let rpResponse;
      if (migrateToManualThroughput) {
        const response = await vscode.window.showInformationMessage(
          localize(
            "migrateToManualThroughputDatabaseConfirm",
            "Are you sure you want to migrate the database {0} to manual throughput?",
            databaseName
          ),
          ...[localize("yes", "Yes"), localize("no", "No")]
        );
        if (response !== "Yes") {
          return false;
        }

        showStatusBarItem(
          localize("migratingDatabaseToManualThroughput", "Migrating database to manual throughput...")
        );
        rpResponse = await client.mongoDBResources.migrateMongoDBDatabaseToManualThroughput(
          resourceGroup,
          cosmosDbAccountName,
          databaseName,
          {
            resource: {
              throughput: requestedThroughput,
            },
          }
        );
      }

      showStatusBarItem(
        localize("updatingDatabaseThroughput", "Updating database throughput to {0} RUs...", requestedThroughput)
      );
      rpResponse = await client.mongoDBResources.updateMongoDBDatabaseThroughput(
        resourceGroup,
        cosmosDbAccountName,
        databaseName,
        {
          resource: {
            throughput: requestedThroughput,
          },
        }
      );

      return !!rpResponse;
    } catch (e) {
      return Promise.reject(e);
    } finally {
      hideStatusBarItem();
    }
  };

  public createDatabase = async (
    azureAccountId: string,
    azureTenantId: string,
    azureResourceId: string,
    cosmosDbAccountName: string,
    databaseName?: string
  ): Promise<{ databaseName: string }> => {
    return new Promise(async (resolve, reject) => {
      const client = await this.createArmClient(azureAccountId, azureTenantId, azureResourceId, cosmosDbAccountName);
      azureResourceId = await this.retrieveResourceId(
        azureAccountId,
        azureTenantId,
        azureResourceId,
        cosmosDbAccountName
      );
      // TODO: check resourceGroup here
      const { resourceGroup } = this.parsedAzureResourceId(azureResourceId);

      const dialog = await createNewDatabaseDialog(async (inputData: NewDatabaseFormData) => {
        const createDbParams: MongoDBDatabaseCreateUpdateParameters = {
          resource: {
            id: inputData.newDatabaseName,
          },
        };

        if (inputData.isShareDatabaseThroughput) {
          if (inputData.isAutoScale) {
            createDbParams.options = {
              autoscaleSettings: {
                maxThroughput: inputData.databaseMaxThroughputRUPS,
              },
            };
          } else {
            createDbParams.options = {
              throughput: inputData.databaseRequiredThroughputRUPS,
            };
          }
        }

        try {
          showStatusBarItem(localize("creatingMongoDatabase", "Creating CosmosDB database"));
          const dbresult = await client.mongoDBResources
            .createUpdateMongoDBDatabase(resourceGroup, cosmosDbAccountName, inputData.newDatabaseName, createDbParams)
            .catch((e) => reject(e));

          if (!dbresult || !dbresult.resource?.id) {
            reject("Could not create database");
            return;
          }

          resolve({ databaseName: dbresult.resource.id });
        } catch (e) {
          reject(e);
        } finally {
          hideStatusBarItem();
        }
      }, databaseName);
      azdata.window.openDialog(dialog);
    });
  };

  /**
   * Do not bring up UI if database and collection are already specified
   * @param azureAccountId
   * @param azureTenantId
   * @param azureResourceId
   * @param cosmosDbAccountName
   * @param databaseName
   * @param collectionName
   * @returns
   */
  public createDatabaseAndCollection = async (
    azureAccountId: string,
    azureTenantId: string,
    azureResourceId: string,
    cosmosDbAccountName: string,
    databaseName?: string,
    collectionName?: string,
    cdbCreateInfo?: CdbCollectionCreateInfo
  ): Promise<{ databaseName: string; collectionName: string | undefined }> => {
    const client = await this.createArmClient(azureAccountId, azureTenantId, azureResourceId, cosmosDbAccountName);
    azureResourceId = await this.retrieveResourceId(
      azureAccountId,
      azureTenantId,
      azureResourceId,
      cosmosDbAccountName
    );
    // TODO: check resourceGroup here
    const { resourceGroup } = this.parsedAzureResourceId(azureResourceId);

    showStatusBarItem(localize("retrievingExistingDatabases", "Retrieving existing databases"));
    const existingDatabases = (
      await this.retrieveDatabasesInfo(azureAccountId, azureTenantId, azureResourceId, cosmosDbAccountName, true)
    ).map((databasesInfo) => ({
      id: databasesInfo.name,
      isSharedThroughput: !!databasesInfo.throughputSetting,
    }));
    hideStatusBarItem();

    return new Promise(async (resolve, reject) => {
      const COLLECTION_DEFAULT_THROUGHPUT_RUPS = 400;

      const createDatabaseCollectioNCB = async (inputData: NewCollectionFormData) => {
        try {
          showStatusBarItem(localize("creatingCosmosDbDatabase", "Creating CosmosDB database"));
          let newDatabaseName;
          if (inputData.isCreateNewDatabase) {
            // If database is shared throughput, we must create it separately, otherwise the
            // createUpdateMongoDBCollection() call will create a plain database for us
            if (inputData.newDatabaseInfo.isShareDatabaseThroughput) {
              const createDbParams: MongoDBDatabaseCreateUpdateParameters = {
                resource: {
                  id: inputData.newDatabaseInfo.newDatabaseName,
                },
              };

              if (inputData.isAutoScale) {
                createDbParams.options = {
                  autoscaleSettings: {
                    maxThroughput: inputData.maxThroughputRUPS,
                  },
                };
              } else {
                createDbParams.options = {
                  throughput: inputData.requiredThroughputRUPS,
                };
              }

              const dbresult = await client.mongoDBResources
                .createUpdateMongoDBDatabase(
                  resourceGroup,
                  cosmosDbAccountName,
                  inputData.newDatabaseInfo.newDatabaseName,
                  createDbParams
                )
                .catch((e) => reject(e));

              if (!dbresult || !dbresult.resource?.id) {
                reject(localize("failedCreatingDatabase", "Failed creating database"));
                return;
              }

              newDatabaseName = dbresult.resource.id;
            } else {
              newDatabaseName = inputData.newDatabaseInfo.newDatabaseName;
            }
          } else {
            newDatabaseName = inputData.existingDatabaseId;
          }

          if (inputData.newCollectionName !== undefined && newDatabaseName !== undefined) {
            const createCollParams: MongoDBCollectionCreateUpdateParameters = {
              resource: {
                id: inputData.newCollectionName,
              },
            };

            if (inputData.isSharded) {
              createCollParams.resource.shardKey = {
                [inputData.shardKey!]: "Hash",
              };
            }

            if (inputData.isProvisionCollectionThroughput) {
              if (inputData.isAutoScale) {
                createCollParams.options = {
                  autoscaleSettings: {
                    maxThroughput: inputData.maxThroughputRUPS,
                  },
                };
              } else {
                createCollParams.options = {
                  throughput: inputData.requiredThroughputRUPS,
                };
              }
            }

            showStatusBarItem(localize("creatingMongoCollection", "Creating CosmosDB Mongo collection"));
            const collResult = await client.mongoDBResources
              .createUpdateMongoDBCollection(
                resourceGroup,
                cosmosDbAccountName,
                newDatabaseName,
                inputData.newCollectionName,
                createCollParams
              )
              .catch((e) => reject(e));

            if (!collResult || !collResult.resource?.id) {
              reject(localize("failedCreatingCollection", "Failed creating collection"));
              return;
            }
            collectionName = collResult.resource.id;
            resolve({ databaseName: newDatabaseName, collectionName });
          }
          reject(localize("collectionOrDatabaseNotSpecified", "Collection or database not specified"));
        } catch (e) {
          reject(e);
        } finally {
          hideStatusBarItem();
        }
      };

      if (databaseName !== undefined && collectionName !== undefined) {
        // If database and collection are specified, do not bring up UI
        // Assumption is database already exists
        createDatabaseCollectioNCB({
          isCreateNewDatabase: false,
          existingDatabaseId: databaseName,
          newDatabaseInfo: {
            newDatabaseName: "",
            isShareDatabaseThroughput: false,
          },
          newCollectionName: collectionName,
          isSharded: true,
          shardKey: cdbCreateInfo?.shardKey,
          isProvisionCollectionThroughput: true,
          isAutoScale: false,
          maxThroughputRUPS: 0,
          requiredThroughputRUPS: cdbCreateInfo?.requiredThroughputRUPS ?? COLLECTION_DEFAULT_THROUGHPUT_RUPS,
        });
        return;
      }

      const dialog = await createNewCollectionDialog(
        createDatabaseCollectioNCB,
        existingDatabases,
        databaseName,
        collectionName
      );
      azdata.window.openDialog(dialog);
    });
  };
}
