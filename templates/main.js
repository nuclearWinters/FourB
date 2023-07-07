export const fetchWrapper = async (input = "", init = {}) => {
    const response = await fetch(input, {
        headers: {
            authorization: sessionStorage.getItem("accessToken"),
            "Content-Type": "application/json"
        },
        ...init
    })
    const accessToken = response.headers.get("accessToken")
    if (accessToken) {
      const payload = accessToken.split(".")[1]
      sessionStorage.setItem("accessToken", payload)
      const data = atob(payload)
      const token = JSON.parse(data)
      sessionStorage.setItem("refreshTokenExpireTime", token.refreshTokenExpireTime)
    } else {
      sessionStorage.removeItem("accessToken")
      sessionStorage.removeItem("refreshTokenExpireTime")
      sessionStorage.removeItem("user")
    }
    const data = await response.json()
    if (response.status !== 200) {
        throw new Error(data)
    }
    return data
}

class Header extends HTMLElement {
    constructor() {
        super()
        this.innerHTML = `<div style="background: black; height: 80px;">
            <button id="go-to-cart">Cart</button>
            <button id="show-log-in">Log in</button>
            <button id="show-register">Register</button>
            <div id="register-modal" class="auth-modal" style="display: none;">
              <form action="http://localhost:8000/register" class="auth-form" method="POST" id="form-register">
                <span id="close-register" class="close">x</span>
                <div>Register</div>
                <label for="email">Email</label>
                <input type="text" name="email" required />
                <label for="password">Password</label>
                <input type="password" name="password" required />
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

    connectedCallback() {
      const getUser = async () => {
        const refreshTokenExpireTime = sessionStorage.getItem("refreshTokenExpireTime")
        if (refreshTokenExpireTime) {
          const numberRefreshTokenExpiration = Number(refreshTokenExpireTime)
          const now = new Date()
          now.setMilliseconds(0)
          const nowSeconds = now / 1000
          if (nowSeconds > numberRefreshTokenExpiration) {
            return
          }
          const data = await fetchWrapper("http://localhost:8000/user")
          sessionStorage.setItem("user", JSON.stringify(data))
        } else {
          const session = sessionStorage.getItem("session")
          if (!session) {
            const data = await fetchWrapper("http://localhost:8000/user")
            sessionStorage.setItem("session", JSON.stringify(data))
          }
        }
      }
      getUser()
      const goToCart = document.getElementById("go-to-cart")
      if (goToCart) {
          goToCart.onclick = () => {
              window.location.href = "/cart"
          }
      }
      const logInSubmit = async (e) => {
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
      const formLogIn = document.getElementById("form-log-in")
      if (formLogIn) {
        formLogIn.addEventListener("submit", logInSubmit)
      }
      const registerSubmit = async (e) => {
        const form = document.getElementById("form-register")
        e.preventDefault();
        try {
          await fetchWrapper("http://localhost:8000/register", {
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
      const formRegister = document.getElementById("form-register")
      if (formRegister) {
        formRegister.addEventListener("submit", registerSubmit)
      }
      const logInModal = document.getElementById("log-in-modal");
      const showLogIn = document.getElementById("show-log-in");
      const closeLogIn = document.getElementById("close-log-in");
      showLogIn.onclick = () => {
        logInModal.style.display = "flex";
      }
      closeLogIn.onclick = () => {
        logInModal.style.display = "none";
      }
      window.onclick = (event) => {
        if (event.target == logInModal) {
          logInModal.style.display = "none";
        }
        if (event.target == registerModal) {
          registerModal.style.display = "none";
        }
      }
      const registerModal = document.getElementById("register-modal");
      const showRegister = document.getElementById("show-register");
      const closeRegister = document.getElementById("close-register");
      showRegister.onclick = () => {
        registerModal.style.display = "flex";
      }
      closeRegister.onclick = () => {
        registerModal.style.display = "none";
      }
    }
}

window.customElements.define('fourb-header', Header);
