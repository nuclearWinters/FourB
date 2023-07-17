export const fetchWrapper = async (input = "", init = {}) => {
    const response = await fetch(input, {
        headers: {
            authorization: sessionStorage.getItem("accessToken"),
            "Content-Type": "application/json"
        },
        ...init
    })
    const accessToken = response.headers.get("accessToken")
    const localAccessToken = sessionStorage.getItem("accessToken")
    if (accessToken && localAccessToken !== accessToken) {
      const payload = accessToken.split(".")[1]
      const data = atob(payload)
      const token = JSON.parse(data)
      sessionStorage.setItem("accessToken", accessToken)
      sessionStorage.setItem("refreshTokenExpireTime", token.refreshTokenExpireTime)
      sessionStorage.setItem("user", JSON.stringify(token.user))
      if (localAccessToken === null) {
        window.location.reload()
      }
    } else if (!accessToken) {
      sessionStorage.removeItem("accessToken")
      sessionStorage.removeItem("refreshTokenExpireTime")
      sessionStorage.removeItem("user")
      if (localAccessToken) {
        window.location.reload()
      }
    }
    const data = await response.json()
    if (response.status !== 200) {
        throw new Error(data)
    }
    return data
}

export const getCookie = (cname) => {
  let name = cname + "=";
  let decodedCookie = decodeURIComponent(document.cookie);
  let ca = decodedCookie.split(';');
  for(let i = 0; i <ca.length; i++) {
    let c = ca[i];
    while (c.charAt(0) == ' ') {
      c = c.substring(1);
    }
    if (c.indexOf(name) == 0) {
      return c.substring(name.length, c.length);
    }
  }
  return "";
}

class Header extends HTMLElement {
  constructor() {
    super()
    this.innerHTML = this.getInnerHTML()
  }

  getInnerHTML = () => {
    const logged = sessionStorage.getItem("accessToken")
    return `<div class="header">
      <button class="header-button" id="go-to-cart">Cart</button>
      ${logged ? "" : `<button class="header-button" id="show-log-in">Log In</button>`}
      ${logged ? "" : `<button class="header-button" id="show-register">Register</button>`}
      ${logged ? `<button class="header-button" id="log-out">Log Out</button>` : ""}
      <div id="register-modal" class="auth-modal" style="display: none;">
        <form action="http://localhost:8000/register" class="auth-form" method="POST" id="form-register">
          <span id="close-register" class="close">x</span>
          <div>Register</div>
          <label for="name">Nombre</label>
          <input type="text" name="name" required />
          <label for="apellidos">Apellidos</label>
          <input type="text" name="apellidos" required />
          <label for="email">Email</label>
          <input type="text" name="email" required />
          <label for="text">Phone</label>
          <div style="display: flex; flex-direction: row;">
            <select type="text" name="phonePrefix" required>
              <option value="+52">🇲🇽 Mexico (+52)</option>
            </selecy>
            <input type="text" name="phone" required />
          </div>
          <label for="password">Password</label>
          <input type="password" name="password" required />
          <label for="password">Confirm Password</label>
          <input type="password" name="confirmPassword" required />
          <button type="submit">Register</button>
        </form>
      </div>
      <div id="log-in-modal" class="auth-modal" style="display: none;">
        <form action="http://localhost:8000/log-in"class="auth-form" method="POST" id="form-log-in">
          <span id="close-log-in" class="close">x</span>
          <div>Log in</div>
          <label for="email">Email</label>
          <input type="text" name="email" required />
          <label for="password">Password</label>
          <input type="password" name="password" required />
          <button type="submit">Log In</button>
        </form>
      </div>
    <div>`
  }

  logInSubmit = async (e) => {
    const form = document.getElementById("form-log-in")
    e.preventDefault();
    try {
      await fetchWrapper("http://localhost:8000/log-in", {
        method: 'POST',
        body: JSON.stringify({ email: form.email.value, password: form.password.value}),
      })
    } catch(e) {
      if (e instanceof Error) {
        alert(e.message)
      } else {
        alert("Error")
      }
    }
  }

  registerSubmit = async (e) => {
    const form = document.getElementById("form-register")
    e.preventDefault();
    try {
      await fetchWrapper("http://localhost:8000/register", {
        method: 'POST',
        body: JSON.stringify({
          name: form.name.value,
          apellidos: form.apellidos.value,
          email: form.email.value,
          password: form.password.value,
          confirmPassword: form.confirmPassword.value,
          phone: form.phone.value,
          phonePrefix: form.phonePrefix.value
        }),
      })
    } catch(e) {
      if (e instanceof Error) {
        alert(e.message)
      } else {
        alert("Error")
      }
    }
  }

    assignFunctions() {
      const logOutButton = document.getElementById("log-out")
      if (logOutButton) {
        logOutButton.onclick = async () => {
          await fetchWrapper("http://localhost:8000/log-out", {
            method: 'POST',
          })
          sessionStorage.clear()
          localStorage.clear()
          window.location.href = "/main"
        }
      }
      const goToCart = document.getElementById("go-to-cart")
      if (goToCart) {
        goToCart.onclick = () => {
          window.location.href = "/cart"
        }
      }
      const registerModal = document.getElementById("register-modal");
      const showRegister = document.getElementById("show-register");
      const closeRegister = document.getElementById("close-register");
      if (showRegister) {
        showRegister.onclick = () => {
          registerModal.style.display = "flex";
        }
      }
      if (closeRegister) {
        closeRegister.onclick = () => {
          registerModal.style.display = "none";
        }
      }
      const logInModal = document.getElementById("log-in-modal");
      const showLogIn = document.getElementById("show-log-in");
      const closeLogIn = document.getElementById("close-log-in");
      if (showLogIn) {
        showLogIn.onclick = () => {
          logInModal.style.display = "flex";
        }
      }
      if (closeLogIn) {
        closeLogIn.onclick = () => {
          logInModal.style.display = "none";
        }
      }
      window.onclick = (event) => {
        if (event.target == logInModal) {
          logInModal.style.display = "none";
        }
        if (event.target == registerModal) {
          registerModal.style.display = "none";
        }
      }
      const formLogIn = document.getElementById("form-log-in")
      if (formLogIn) {
        formLogIn.addEventListener("submit", this.logInSubmit)
      }
      const formRegister = document.getElementById("form-register")
      if (formRegister) {
        formRegister.addEventListener("submit", this.registerSubmit)
      }
    }

    connectedCallback() {
      this.assignFunctions()
    }
}

window.customElements.define('fourb-header', Header);
