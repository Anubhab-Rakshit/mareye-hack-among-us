import { NextRequest, NextResponse } from "next/server"
import { getUserCollection } from "@/dbCollections"
import * as bcrypt from "bcryptjs"
import * as jwt from "jsonwebtoken"
import {
  createHoneypotAdminSessionToken,
  honeypotAdminCookieName,
  honeypotAdminCookieOptions,
  isConfiguredHoneypotAdminCredential,
} from "@/lib/honeypot-admin"

const JWT_SECRET = process.env.JWT_SECRET || "supersecret"
const TOKEN_MAX_AGE_SECONDS = 60 * 60 * 24 * 30 // 30 days - extended session

function dbConfigError(err: unknown) {
  const msg = err instanceof Error ? err.message : String(err)
  return msg.toLowerCase().includes("mongodb_uri is not set")
}

export async function POST(req: NextRequest) {
  try {
    const { email, password } = await req.json()

    if (!email || !password) {
      return NextResponse.json({ message: "Missing email or password" }, { status: 400 })
    }

    // ═══ HONEYPOT ADMIN BYPASS — allows login even without DB entry ═══
    const isHoneypotAdminDirect = isConfiguredHoneypotAdminCredential(email, password)
    if (isHoneypotAdminDirect) {
      const adminId = "honeypot-admin-" + Date.now()
      const token = jwt.sign(
        { id: adminId, email },
        JWT_SECRET,
        { expiresIn: TOKEN_MAX_AGE_SECONDS }
      )

      const response = NextResponse.json({
        message: "Login successful",
        user: {
          id: adminId,
          email,
          firstName: "Srijit",
          lastName: "Admin",
          avatar: null,
          isHoneypotAdmin: true,
        }
      }, { status: 200 })

      response.cookies.set("auth_token", token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: TOKEN_MAX_AGE_SECONDS,
        path: "/",
        expires: new Date(Date.now() + TOKEN_MAX_AGE_SECONDS * 1000)
      })

      const adminSessionToken = createHoneypotAdminSessionToken(email)
      response.cookies.set(honeypotAdminCookieName(), adminSessionToken, honeypotAdminCookieOptions())

      return response
    }
    // ═══ END HONEYPOT ADMIN BYPASS ═══

    const users = await getUserCollection()
    const user = await users.findOne({ email })

    if (!user) {
      return NextResponse.json({ message: "Invalid credentials" }, { status: 401 })
    }

    const isPasswordValid = await bcrypt.compare(password, user.password)
    if (!isPasswordValid) {
      return NextResponse.json({ message: "Invalid credentials" }, { status: 401 })
    }

    const isHoneypotAdmin = isConfiguredHoneypotAdminCredential(email, password)

    // Create token with consistent field name
    const token = jwt.sign(
      { 
        id: user._id.toString(), // Changed from "userId" to "id"
        email: user.email 
      },
      JWT_SECRET,
      { expiresIn: TOKEN_MAX_AGE_SECONDS }
    )

    // Create response and set cookie
    const response = NextResponse.json({ 
      message: "Login successful",
      user: {
        id: user._id.toString(),
        email: user.email,
        firstName: user.firstName || user.username, // Handle both old and new schema
        lastName: user.lastName || "",
        dob: user.dob,
        avatar: user.avatar,
        isHoneypotAdmin
      }
    }, { status: 200 })

    // Set the token as an HTTP-only cookie with extended expiration
    response.cookies.set("auth_token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: TOKEN_MAX_AGE_SECONDS,
      path: "/",
      expires: new Date(Date.now() + TOKEN_MAX_AGE_SECONDS * 1000)
    })

    if (isHoneypotAdmin) {
      const adminSessionToken = createHoneypotAdminSessionToken(email)
      response.cookies.set(honeypotAdminCookieName(), adminSessionToken, honeypotAdminCookieOptions())
    } else {
      response.cookies.set(honeypotAdminCookieName(), "", {
        ...honeypotAdminCookieOptions(),
        maxAge: 0,
        expires: new Date(0),
      })
    }

    return response
  } catch (error) {
    console.error("Login error:", error)
    if (dbConfigError(error)) {
      return NextResponse.json(
        { message: "Database not configured. Set MONGODB_URI in .env.local (see ENVIRONMENT_SETUP.md)." },
        { status: 500 }
      )
    }
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}
