/* eslint-disable no-param-reassign */
/* eslint-disable spellcheck/spell-checker */
import inquirer, { QuestionCollection } from 'inquirer';
import ora from 'ora';
import fs from 'fs-extra';
import {
  $TSAny, $TSContext, amplifyFaultWithTroubleshootingLink,
} from 'amplify-cli-core';

import { printer } from 'amplify-prompts';
import * as configureKey from './apns-key-config';
import * as configureCertificate from './apns-cert-config';
import { ChannelAction, IChannelAPIResponse, ChannelConfigDeploymentType } from './channel-types';
import { buildPinpointChannelResponseSuccess } from './pinpoint-helper';

const channelName = 'APNS';
const spinner = ora('');
const deploymentType = ChannelConfigDeploymentType.INLINE;

/**
 * Configure the Pinpoint resource to enable the Apple Push Notifications Messaging channel
 * @param context amplify cli context
 */
export const configure = async (context: $TSContext): Promise<IChannelAPIResponse> => {
  const isChannelEnabled = context.exeInfo.serviceMeta.output[channelName]?.Enabled;
  let response: IChannelAPIResponse|undefined;
  if (isChannelEnabled) {
    printer.info(`The ${channelName} channel is currently enabled`);
    const answer = await inquirer.prompt({
      name: 'disableChannel',
      type: 'confirm',
      message: `Do you want to disable the ${channelName} channel`,
      default: false,
    });
    if (answer.disableChannel) {
      response = await disable(context);
    } else {
      const successMessage = `The ${channelName} channel has been successfully updated.`;
      response = await enable(context, successMessage);
    }
  } else {
    const answer = await inquirer.prompt({
      name: 'enableChannel',
      type: 'confirm',
      message: `Do you want to enable the ${channelName} channel`,
      default: true,
    });
    if (answer.enableChannel) {
      response = await enable(context, undefined);
    }
  }
  if (response) {
    return response;
  }
  return buildPinpointChannelResponseSuccess(ChannelAction.CONFIGURE, deploymentType, channelName);
};

/**
 * Enable Walkthrough for the APN (Apple Push Notifications) channel for notifications
 * @param context amplify cli context
 * @param successMessage optional message to be displayed on successfully enabling channel for notifications
 */
export const enable = async (context: $TSContext, successMessage: string | undefined) : Promise<$TSAny> => {
  let channelInput;
  let answers;
  if (context.exeInfo.pinpointInputParams?.[channelName]) {
    channelInput = validateInputParams(ChannelAction.ENABLE, context.exeInfo.pinpointInputParams[channelName]);
    answers = {
      DefaultAuthenticationMethod: channelInput.DefaultAuthenticationMethod,
    };
  } else {
    let channelOutput : $TSAny = {};
    if (context.exeInfo.serviceMeta.output[channelName]) {
      channelOutput = context.exeInfo.serviceMeta.output[channelName];
    }
    const question: QuestionCollection<{ [x: string]: unknown; }> = {
      name: 'DefaultAuthenticationMethod',
      type: 'list',
      message: 'Choose authentication method used for APNs',
      choices: ['Certificate', 'Key'],
      default: channelOutput.DefaultAuthenticationMethod || 'Certificate',
    };
    answers = await inquirer.prompt(question);
  }

  if (answers.DefaultAuthenticationMethod === 'Key') {
    const keyConfig = await configureKey.run(channelInput);
    Object.assign(answers, keyConfig);
  } else {
    const certificateConfig = await configureCertificate.run(channelInput);
    Object.assign(answers, certificateConfig);
  }

  spinner.start('Enabling APNS Channel.');

  const params = {
    ApplicationId: context.exeInfo.serviceMeta.output.Id,
    APNSChannelRequest: {
      ...answers,
      Enabled: true,
    },
  };

  const sandboxParams = {
    ApplicationId: context.exeInfo.serviceMeta.output.Id,
    APNSSandboxChannelRequest: {
      ...answers,
      Enabled: true,
    },
  };

  let data;
  try {
    data = await context.exeInfo.pinpointClient.updateApnsChannel(params).promise();
    await context.exeInfo.pinpointClient.updateApnsSandboxChannel(sandboxParams).promise();
    context.exeInfo.serviceMeta.output[channelName] = data.APNSChannelResponse;
  } catch (e) {
    spinner.stop();
    throw amplifyFaultWithTroubleshootingLink('NotificationsChannelAPNSFault', {
      message: `Failed to enable the ${channelName} channel.`,
      details: e.message,
    });
  }

  if (!successMessage) {
    successMessage = `The ${channelName} channel has been successfully enabled.`;
  }
  spinner.succeed(successMessage);
  return buildPinpointChannelResponseSuccess(ChannelAction.ENABLE, deploymentType, channelName, data.APNSChannelResponse);
};

const validateInputParams = (action: ChannelAction, channelInput: $TSAny): $TSAny => {
  if (channelInput.DefaultAuthenticationMethod) {
    const authMethod = channelInput.DefaultAuthenticationMethod;
    if (authMethod === 'Certificate') {
      if (!channelInput.P12FilePath) {
        throw amplifyFaultWithTroubleshootingLink('NotificationsChannelAPNSFault', {
          message: 'P12FilePath is missing for the APNS channel',
          details: `Action: ${action}`,
        });
      } else if (!fs.existsSync(channelInput.P12FilePath)) {
        throw amplifyFaultWithTroubleshootingLink('NotificationsChannelAPNSFault', {
          message: `P12 file ${channelInput.P12FilePath} can NOT be found for the APNS channel`,
          details: `Action: ${action}`,
        });
      }
    } else if (authMethod === 'Key') {
      if (!channelInput.BundleId || !channelInput.TeamId || !channelInput.TokenKeyId) {
        throw amplifyFaultWithTroubleshootingLink('NotificationsChannelAPNSFault', {
          message: 'Missing BundleId, TeamId or TokenKeyId for the APNS channel',
          details: `Action: ${action}`,
        });
      } else if (!channelInput.P8FilePath) {
        throw amplifyFaultWithTroubleshootingLink('NotificationsChannelAPNSFault', {
          message: 'P8FilePath is missing for the APNS channel',
          details: `Action: ${action}`,
        });
      } else if (!fs.existsSync(channelInput.P8FilePath)) {
        throw amplifyFaultWithTroubleshootingLink('NotificationsChannelAPNSFault', {
          message: `P8 file ${channelInput.P8FilePath} can NOT be found for the APNS channel`,
          details: `Action: ${action}`,
        });
      }
    } else {
      throw amplifyFaultWithTroubleshootingLink('NotificationsChannelAPNSFault', {
        message: `DefaultAuthenticationMethod ${authMethod} is unrecognized for the APNS channel`,
        details: `Action: ${action}`,
      });
    }
  } else {
    throw amplifyFaultWithTroubleshootingLink('NotificationsChannelAPNSFault', {
      message: 'DefaultAuthenticationMethod is missing for the APNS channel',
      details: `Action: ${action}`,
    });
  }
  return channelInput;
};

/**
 * Disable walkthrough for APN type notifications channel information from the cloud and update the Pinpoint resource metadata
 * @param context amplify cli notifications
 * @returns APNChannel response
 */
export const disable = async (context: $TSContext) : Promise<$TSAny> => {
  const params = {
    ApplicationId: context.exeInfo.serviceMeta.output.Id,
    APNSChannelRequest: {
      Enabled: false,
    },
  };

  const sandboxParams = {
    ApplicationId: context.exeInfo.serviceMeta.output.Id,
    APNSSandboxChannelRequest: {
      Enabled: false,
    },
  };

  spinner.start('Disabling APNS Channel.');

  let data;
  try {
    data = await context.exeInfo.pinpointClient.updateApnsChannel(params).promise();
    await context.exeInfo.pinpointClient.updateApnsSandboxChannel(sandboxParams).promise();
  } catch (e) {
    spinner.fail(`Failed to update the ${channelName} channel.`);
    throw amplifyFaultWithTroubleshootingLink('NotificationsChannelAPNSFault', {
      message: `Failed to update the ${channelName} channel.`,
      details: `Action: ${ChannelAction.DISABLE}. ${e.message}`,
    });
  }
  spinner.succeed(`The ${channelName} channel has been disabled.`);
  context.exeInfo.serviceMeta.output[channelName] = data.APNSChannelResponse;
  return buildPinpointChannelResponseSuccess(ChannelAction.DISABLE, deploymentType, channelName, data.APNSChannelResponse);
};

/**
 * Pull Walkthrough for APN type notifications channel information from the cloud and update the Pinpoint resource metadata
 * @param context amplify cli context
 * @param pinpointApp Pinpoint resource metadata
 * @returns APNChannel response
 */
export const pull = async (context:$TSContext, pinpointApp:$TSAny): Promise<$TSAny> => {
  const params = {
    ApplicationId: pinpointApp.Id,
  };

  spinner.start(`Retrieving channel information for ${channelName}.`);

  try {
    const data = await context.exeInfo.pinpointClient.getApnsChannel(params).promise();
    spinner.succeed(`Channel information retrieved for ${channelName}`);
    pinpointApp[channelName] = data.APNSChannelResponse;
    return buildPinpointChannelResponseSuccess(ChannelAction.PULL, deploymentType, channelName, data.APNSChannelResponse);
  } catch (err) {
    spinner.stop();
    if (err.code !== 'NotFoundException') {
      throw amplifyFaultWithTroubleshootingLink('NotificationsChannelAPNSFault', {
        message: `Failed to pull the ${channelName} channel.`,
        details: `Action: ${ChannelAction.PULL}. ${err.message}`,
      });
    }

    return undefined;
  }
};
