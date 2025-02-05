import { TFunction } from "i18next";
import React from "react";
import { observer } from "mobx-react";
import { withTranslation, WithTranslation } from "react-i18next";
import styled, { DefaultTheme, withTheme } from "styled-components";

import Button from "terriajs/lib/Styled/Button";
import Box from "terriajs/lib/Styled/Box";
import Text from "terriajs/lib/Styled/Text";
import Spacing from "terriajs/lib/Styled/Spacing";
import Input from "terriajs/lib/Styled/Input";
import withTerriaRef from "terriajs/lib/ReactViews/HOCs/withTerriaRef";
import MenuPanel from "terriajs/lib/ReactViews/StandardUserInterface/customizable/MenuPanel";
import Styles from "./login-panel.scss";

import { DisplayError } from "../custom-errors";
import EncodingUtilities from "../EncodingUtilities";
import LoginManager, { AuthData, LoginCredentials } from "../LoginManager";

import {
  ViewState_Arbm as ViewState,
  LoginData
} from "../../terriajsOverrides/ViewState_Arbm";

type Modus = "typing" | "loading" | "updatingCatalog";
type LoginStep =
  | "typingUsername"
  | "loadingUser"
  | "typingPassword"
  | "authenticatingPassword"
  | "authenticatingDongle"
  | "updatingCatalog";

interface PropTypes extends WithTranslation {
  viewState: ViewState;
  refFromHOC?: React.Ref<HTMLDivElement>;
  theme: DefaultTheme;
  t: TFunction;
}

interface LoginPanelState {
  isOpen: boolean;
  username: string;
  password: string;
  modus: Modus;
  authData: AuthData | undefined;
  error: string;
}

const INITIAL_STATE: LoginPanelState = {
  isOpen: false,
  username: "",
  password: "",
  modus: "typing",
  authData: undefined,
  error: ""
};

const Form = styled(Box).attrs({
  overflowY: "auto",
  scroll: true,
  as: "form"
})``;

// ==============================================================================================================

//@ts-ignore
@observer
class LoginPanel extends React.Component<PropTypes, LoginPanelState> {
  keyListener: (e: any) => void;
  abortController?: AbortController;
  baseURL: string;

  // ---------------------------------------------------------------------------------------------------

  constructor(props: PropTypes) {
    super(props);

    this.baseURL = props.viewState.treesAppUrl!;

    this.keyListener = (e) => {
      if (e.key === "Escape") {
        this.onDismiss();
      } else if (e.key === "Enter") {
        // Map to hitting the button only if currently typing, and what is being typed is not empty
        // If user is typing, they are either typing username, or password
        if (this.state.modus !== "typing") return;
        const currentStep: LoginStep = this.getLoginStep();
        // determine function to call, and value to test for non-emptyness
        const [f, value] =
          currentStep == "typingUsername"
            ? [this.fetchUser, this.state.username]
            : [this.tryLogin, this.state.password];
        if (value) {
          f();
        }
      }
    };

    this.state = { ...INITIAL_STATE };
  }

  // ---------------------------------------------------------------------------------------------------

  componentDidMount = () => {
    const { viewState } = this.props;
    window.addEventListener("keydown", this.keyListener, true);
    this.abortController = new AbortController();
    viewState.removeCookies();
  };

  // ---------------------------------------------------------------------------------------------------

  componentWillUnmount = () => {
    window.removeEventListener("keydown", this.keyListener, true);
    this.abortController?.abort();
    this.abortController = undefined;
  };

  // ---------------------------------------------------------------------------------------------------

  private resetState = () => {
    this.setState({ ...INITIAL_STATE });
  };

  // ---------------------------------------------------------------------------------------------------

  private onDismiss = () => {
    this.resetState();
  };

  // ---------------------------------------------------------------------------------------------------

  private abortWhileMounted() {
    // Each instnce of AbortController can abort() only once, afterwards
    // each new signal generated by the AbortController has a state of being already aborted.
    // Since aborting is supposed to open when the user closes the LoginPanel, but
    // closing the LoginPanel only closes it, but does not necessarily unmount it,
    // we have to re-create a new AbortController for when the user tries again to log in.
    this.abortController?.abort();
    this.abortController = new AbortController();
  }

  // ---------------------------------------------------------------------------------------------------

  private changeOpenState = (open: boolean) => {
    const wasOpen = this.state.isOpen;
    this.setState({ isOpen: open });
    if (!wasOpen && open) {
      this.focus("username");
    } else if (wasOpen && !open) {
      this.abortWhileMounted();
      this.resetState();
    }
  };

  // ---------------------------------------------------------------------------------------------------

  private storeAuthData = (
    authData: AuthData | undefined,
    error: string | null = null
  ) => {
    this.setState({ authData: authData });
    if (error !== null) {
      this.setState({ error: error });
    }
  };

  // ---------------------------------------------------------------------------------------------------

  closePanel = () => {
    this.changeOpenState(false);
    this.setState({ error: "" });
  };

  // ---------------------------------------------------------------------------------------------------

  private focus = (whichInput: "username" | "password") => {
    setTimeout(() => {
      const elInput: HTMLInputElement | null = document.querySelector(
        "input." + whichInput
      );
      if (elInput) {
        elInput.focus();
      }
    }, 100);
  };

  // ---------------------------------------------------------------------------------------------------

  private updateUsername = (username: string, error: string | null = null) => {
    this.setState({ username: username });
    if (error !== null) {
      this.setState({ error: error });
    }
  };

  // ---------------------------------------------------------------------------------------------------

  private updatePassword = (password: string, error: string | null = null) => {
    this.setState({ password: password });
    if (error !== null) {
      this.setState({ error: error });
    }
  };

  // ---------------------------------------------------------------------------------------------------

  private updateModus = (newModus: Modus, error: string | null = null) => {
    this.setState({ modus: newModus });
    if (error !== null) {
      this.setState({ error: error });
    }
    const newStep = this.calcLoginStep(newModus, this.state.authData); // calculate what it will be after modus is updated
    if (newStep == "typingPassword") {
      this.focus("password");
    }
  };

  // ---------------------------------------------------------------------------------------------------

  private calcLoginStep(
    modus: Modus,
    authData: AuthData | undefined
  ): LoginStep {
    if (modus == "typing") {
      return authData === undefined ? "typingUsername" : "typingPassword";
    } else if (modus == "loading") {
      return authData === undefined
        ? "loadingUser"
        : authData.userInfo.hasAuthenticators
        ? "authenticatingDongle"
        : "authenticatingPassword";
    } else {
      return modus as LoginStep;
    }
  }

  // ---------------------------------------------------------------------------------------------------

  private getLoginStep = (): LoginStep => {
    const modus: Modus = this.state.modus;
    const authData: AuthData | undefined = this.state.authData;
    return this.calcLoginStep(modus, authData);
  };

  // ---------------------------------------------------------------------------------------------------

  private fetchUser = async () => {
    this.updateModus("loading", "");

    const { viewState } = this.props;
    const abortSignal = this.abortController?.signal ?? null;

    return LoginManager.getUserInfo(
      this.state.username,
      viewState.terria.supportEmail,
      this.baseURL,
      abortSignal
    )
      .then((data) => {
        this.storeAuthData(data);
        if (data.userInfo.hasAuthenticators) {
          this.tryLogin(); // no more info required, verify dongle
        } else {
          this.updateModus("typing", ""); // -> will see the section where user can enter pasword
        }
      })
      .catch((error) => {
        if (error.name === "AuthenticationError") {
          // Stay in the login dialog, to let the user enter another username,
          // but show an error message
          this.updateModus(
            "typing",
            `User ${this.state.username} has neither authentictor nor password.`
          );
        } else {
          this.handleFetchError(error);
        }
      });
  };
  // ---------------------------------------------------------------------------------------------------

  private handleFetchError(error) {
    if (error.name == "AbortError") {
      // chances are this happened because the panel was closed, but make extra sure
      this.changeOpenState(false);
      this.resetState();
    } else if (error.name === "TimeoutError" || error.name === "DisplayError") {
      const { t, viewState } = this.props;
      this.closePanel();
      this.resetState();
      const message =
        error.name === "DisplayError"
          ? error.message
          : t("django.errors.unresponsive", {
              email: viewState.terria.supportEmail
            });
      this.displayError(message);
    } else {
      this.updateModus("typing", error.message);
    }
  }

  // ---------------------------------------------------------------------------------------------------

  private displayError(message: string) {
    const { t, viewState } = this.props;
    viewState.terria.notificationState.addNotificationToQueue({
      title: t("loginPanel.errors.title"),
      message: message
    });
  }

  // ---------------------------------------------------------------------------------------------------

  private handleAuthenticationFailure = (
    exitLogin: boolean,
    errorMessage: string
  ) => {
    this.updateModus("typing", errorMessage);
    if (exitLogin) {
      this.storeAuthData(undefined); // -> go back to entering username
      this.focus("username");
    }
  };

  // ---------------------------------------------------------------------------------------------------

  private tryLogin = async () => {
    this.updateModus("loading", "");
    const { t, viewState } = this.props;

    const usingAuthenticator: boolean =
      this.state.authData!.userInfo.hasAuthenticators;

    const credentials: LoginCredentials = {
      username: this.state.username
    };
    if (usingAuthenticator) {
      let browserVerificationResults = await LoginManager.verifyDongleByBrowser(
        this.state.authData!
      );
      if (browserVerificationResults === null) {
        // timeout, or user cancelled
        this.closePanel();
        return;
      }
      credentials.viaDongle = browserVerificationResults;
    } else {
      if (!this.state.password) {
        this.handleAuthenticationFailure(
          true,
          t("loginPanel.errors.noKeyOrPW")
        );
        return;
      }
      credentials.viaPassword = this.state.password!;
    }
    const abortSignal = this.abortController?.signal ?? null;
    try {
      // send a auth/login request to Django
      const loginData = await LoginManager.sendLoginRequest(
        this.baseURL,
        abortSignal,
        credentials
      );
      // store the 'logged-in' state in the front-end and close dialog
      this.login(loginData);
    } catch (error) {
      if (error.name == "TimeoutError" || error.name == "AbortError") {
        this.handleFetchError(error);
      } else {
        const message = error instanceof Error ? error.message : String(error);
        const usingAuthenticator: boolean = !this.state.password;
        this.handleAuthenticationFailure(usingAuthenticator, message);
      }
    }
  };

  // ---------------------------------------------------------------------------------------------------

  private login = async (loginData: LoginData) => {
    this.updateModus("updatingCatalog", "");
    this.resetState();
    // Must happen after we called this.resetState() because logging in via the viewState
    // will cause the LoginPanel component to be unmounted, and once unmounted, the state should never be changed.
    await this.props.viewState.login(loginData);
  };

  // ---------------------------------------------------------------------------------------------------

  render() {
    const { t } = this.props;
    const currentStep: LoginStep = this.getLoginStep();

    const dropdownTheme = {
      inner: Styles.dropdownInner,
      icon: "user"
    };

    const errorMsg = this.state.error;

    function _onSubmit(e: React.FormEvent<HTMLFormElement | HTMLDivElement>) {
      e.preventDefault();
      e.stopPropagation();
    }

    return (
      //@ts-ignore - not yet ready to tackle tsfying MenuPanel
      <MenuPanel
        theme={dropdownTheme}
        btnRef={this.props.refFromHOC}
        btnTitle={t("loginPanel.btnTitle")} //
        btnText={t("loginPanel.btnText")} //
        isOpen={this.state.isOpen}
        // onDismissed={this.resetState}
        onOpenChanged={this.changeOpenState}
        viewState={this.props.viewState}
        smallScreen={this.props.viewState.useSmallScreenInterface}
      >
        <Box padded column>
          {errorMsg !== "" && (
            <>
              <Spacing bottom={5} />
              <Text bold color={"#FF0000"}>
                {this.state.error}
              </Text>
              <Spacing bottom={5} />
            </>
          )}

          {currentStep == "typingUsername" && (
            <Box column>
              <Text as="label">{t("loginPanel.enterUsername")}</Text>
              <Spacing bottom={3} />
              <Input
                dark
                type="text"
                autoComplete="username"
                placeholder={t("loginPanel.username")}
                value={this.state.username}
                onClick={(e) => e.currentTarget.select()}
                onChange={(e) => this.updateUsername(e.currentTarget.value, "")}
                className={"username"}
              />
              <Spacing bottom={3} />
              <Button
                rounded={true}
                primary={true}
                onClick={this.fetchUser}
                disabled={this.state.username == ""}
              >
                {t("loginPanel.next")}
              </Button>
            </Box>
          )}
          {currentStep == "loadingUser" && (
            <div>{t("loginPanel.progress.loadingUser")}</div>
          )}
          {currentStep == "typingPassword" && (
            <Form paddedRatio={2} onSubmit={_onSubmit} column>
              <Text as="label">
                {t("loginPanel.enterPW", {
                  username: EncodingUtilities.sanitizeHTML(this.state.username)
                })}
              </Text>
              <Spacing bottom={3} />
              <Input
                dark
                type="password"
                autoComplete="current-password"
                placeholder={"Password"}
                value={this.state.password}
                onClick={(e) => e.currentTarget.select()}
                onChange={(e) => this.updatePassword(e.currentTarget.value, "")}
                className={"password"}
              />
              <Spacing bottom={3} />
              <Button
                rounded={true}
                primary={true}
                onClick={this.tryLogin}
                disabled={this.state.password == ""}
              >
                {"Login"}
              </Button>
            </Form>
          )}
          {currentStep == "authenticatingPassword" && (
            <div>{t("loginPanel.progress.authingPW")}</div>
          )}
          {currentStep == "authenticatingDongle" && (
            <div>{t("loginPanel.progress.authingDongle")}</div>
          )}
          {currentStep == "updatingCatalog" && (
            <div>{"Updating Catalog..."}</div>
          )}
        </Box>
      </MenuPanel>
    );
  }
}

// ==================================================================================================================

export const LOGIN_PANEL_NAME = "MenuBarLoginButton";
export default withTranslation()(
  withTheme(withTerriaRef(LoginPanel, LOGIN_PANEL_NAME))
);
